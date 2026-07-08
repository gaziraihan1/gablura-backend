import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { 
  createUser, 
  createWorkspaceWithOwner, 
  addMemberToWorkspace 
} from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';
import { prisma } from '../../lib/prisma.js';

describe('💬 Communication & Notification Journeys', () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
  });

  it('should handle the "Full Comment & Mention" journey', async () => {
    /**
     * JOURNEY:
     * 1. User A creates a task
     * 2. User B is added to workspace and comments on task
     * 3. User B mentions User A in the comment
     * 4. User A verifies they received a notification
     * 5. User A replies to the comment
     * 6. User A marks the notification as read
     */
    const userAHeaders = await authWithCsrfHeaders(testUser);
    
    // 1. Create Task
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set(userAHeaders)
      .send({ name: 'Comm Project', workspaceId: testWorkspace.id });
    const project = projRes.body.data;

    const taskRes = await request(app)
      .post('/api/v1/tasks')
      .set(userAHeaders)
      .send({ title: 'Discussable Task', projectId: project.id, workspaceId: testWorkspace.id });
    const task = taskRes.body.data;

    // 2. User B joins and comments
    const otherUser = await createUser();
await addMemberToWorkspace(otherUser.id, testWorkspace.id);
await prisma.projectMember.create({
  data: { userId: otherUser.id, projectId: projRes.body.data.id, role: 'COLLABORATOR' },
});
const otherHeaders = await authWithCsrfHeaders(otherUser);

    // 3. User B mentions User A
    // We assume the mention system uses @userId or similar, but we'll use the format expected by the system
    const commentRes = await request(app)
      .post(`/api/v1/tasks/${task.id}/comments`)
      .set(otherHeaders)
      .send({ 
        content: `Hey @${testUser.id}, what do you think about this?` 
      });

    expect(commentRes.status).toBe(201);
    const comment = commentRes.body.data;

    // 4. User A verifies notification
    const notifRes = await request(app)
      .get('/api/v1/notifications')
      .set(userAHeaders);

    expect(notifRes.status).toBe(200);
    expect(notifRes.body.data.items.some((n: any) => n.type === 'TASK_COMMENTED' || n.type === 'MENTION')).toBe(true);

    // 5. User A replies
    const replyRes = await request(app)
      .post(`/api/v1/tasks/${task.id}/comments`)
      .set(userAHeaders)
      .send({ 
        content: 'I think it looks great!',
        parentId: comment.id 
      });

    expect(replyRes.status).toBe(201);

    // 6. User A marks notification as read
    const notificationId = notifRes.body.data.items[0].id;
    const readRes = await request(app)
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set(userAHeaders);

    expect(readRes.status).toBe(200);
  });

  it('should handle "Notification Management" journey', async () => {
    const headers = await authWithCsrfHeaders(testUser);

    const projRes = await request(app).post('/api/v1/projects').set(headers).send({ name: 'Notif Project', workspaceId: testWorkspace.id });
    const taskRes = await request(app).post('/api/v1/tasks').set(headers).send({ title: 'Notif Task', projectId: projRes.body.data.id, workspaceId: testWorkspace.id });
    const task = taskRes.body.data;

    const otherUser = await createUser();
    await addMemberToWorkspace(otherUser.id, testWorkspace.id);
    await prisma.projectMember.create({
      data: { userId: otherUser.id, projectId: projRes.body.data.id, role: 'COLLABORATOR' },
    });
    const otherHeaders = await authWithCsrfHeaders(otherUser);

    await request(app).post(`/api/v1/tasks/${task.id}/comments`).set(otherHeaders).send({ content: 'Notif 1' });
    await request(app).post(`/api/v1/tasks/${task.id}/comments`).set(otherHeaders).send({ content: 'Notif 2' });

    const countRes = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(headers);

    expect(countRes.status).toBe(200);
    expect(countRes.body.data.count).toBeGreaterThanOrEqual(2);

    const allReadRes = await request(app)
      .patch('/api/v1/notifications/read-all')
      .set(headers);

    expect(allReadRes.status).toBe(200);

    const countRes2 = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set(headers);
    expect(countRes2.body.data.count).toBe(0);

    const listRes = await request(app).get('/api/v1/notifications').set(headers);
    const notifId = listRes.body.data.items[0].id;
    const delRes = await request(app).delete(`/api/v1/notifications/${notifId}`).set(headers);
    expect(delRes.status).toBe(200);
  });

  it('should handle "Announcement Lifecycle" journey', async () => {
    /**
     * JOURNEY:
     * 1. Owner creates a workspace-wide announcement
     * 2. Owner creates a project-specific announcement
     * 3. Member verifies they can see both
     * 4. Owner pins the workspace announcement
     * 5. Owner deletes the project announcement
     * 6. Member verifies the updated list
     */
    const ownerHeaders = await authWithCsrfHeaders(testUser);

    // Setup: Create a project
    const projRes = await request(app)
      .post('/api/v1/projects')
      .set(ownerHeaders)
      .send({ name: 'Announce Project', workspaceId: testWorkspace.id });
    const project = projRes.body.data;

    // 1. Create Workspace Announcement
    const wsAnnRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
      .set(ownerHeaders)
      .send({
        title: 'Global News',
        content: 'Welcome to the workspace!',
        visibility: 'PUBLIC',
      });
    expect(wsAnnRes.status).toBe(201);
    const wsAnn = wsAnnRes.body.data;

    // 2. Create Project Announcement
    const projAnnRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
      .set(ownerHeaders)
      .send({
        title: 'Project News',
        content: 'Focus on the deadline!',
        projectId: project.id,
        visibility: 'PUBLIC',
      });
    expect(projAnnRes.status).toBe(201);
    const projAnn = projAnnRes.body.data;

    // 3. Member verifies
    const member = await createUser();
    await addMemberToWorkspace(member.id, testWorkspace.id);
    const memberHeaders = await authWithCsrfHeaders(member);

    const listRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
      .set(memberHeaders);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((a: any) => a.id === wsAnn.id)).toBe(true);
    expect(listRes.body.data.some((a: any) => a.id === projAnn.id)).toBe(true);

    // 4. Pin Workspace Announcement
    const pinRes = await request(app)
      .patch(`/api/v1/announcements/${wsAnn.id}/pin`)
      .set(ownerHeaders);
    expect(pinRes.status).toBe(200);
    expect(pinRes.body.data.isPinned).toBe(true);

    // 5. Delete Project Announcement
    const delRes = await request(app)
      .delete(`/api/v1/announcements/${projAnn.id}`)
      .set(ownerHeaders);
    expect(delRes.status).toBe(200);

    // 6. Member verifies updated list
    const finalListRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
      .set(memberHeaders);
    expect(finalListRes.status).toBe(200);
    expect(finalListRes.body.data.some((a: any) => a.id === wsAnn.id)).toBe(true);
    expect(finalListRes.body.data.some((a: any) => a.id === projAnn.id)).toBe(false);
  });
});
