import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  createUser,
  createWorkspaceWithOwner,
  addMemberToWorkspace,
  createProject,
} from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';
import { WorkspaceRole, TaskStatus, Priority } from '@prisma/client';

/**
 * E2E User Journeys
 * 
 * These tests simulate real-world user flows across multiple modules.
 * They verify that the components (Auth -> Workspace -> Project -> Task)
 * work together as a cohesive system.
 */
describe('🚀 E2E User Journeys', () => {
  
  describe('Journey 1: The New User Onboarding & Setup', () => {
    it('should allow a user to create a workspace and start their first project', async () => {
      // 1. Setup User
      const user = await createUser();
      
      // 2. Create Workspace
      const wsRes = await request(app)
        .post('/api/v1/workspaces')
        .set(await authWithCsrfHeaders(user))
        .send({ name: 'My First Workspace' });
      
      expect(wsRes.status).toBe(201);
      const workspace = wsRes.body.data;
      
      // 3. Create Project in that Workspace
      const projRes = await request(app)
        .post('/api/v1/projects')
        .set(await authWithCsrfHeaders(user))
        .send({
          name: 'Initial Setup',
          workspaceId: workspace.id,
          workspaceSlug: workspace.slug
        });
      
      expect(projRes.status).toBe(201);
      const project = projRes.body.data;
      
      // 4. Create first task
      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set(await authWithCsrfHeaders(user))
        .send({
          title: 'Complete onboarding',
          projectId: project.id,
          priority: Priority.HIGH
        });
      
      expect(taskRes.status).toBe(201);
      expect(taskRes.body.data.title).toBe('Complete onboarding');
      
      // 5. Verify everything is linked correctly in DB
      const dbTask = await prisma.task.findUnique({ where: { id: taskRes.body.data.id } });
      expect(dbTask?.workspaceId).toBe(workspace.id);
      expect(dbTask?.projectId).toBe(project.id);
    });
  });

  describe('Journey 2: Team Collaboration Flow', () => {
    it('should allow an owner to invite a member, and the member to contribute', async () => {
      // 1. Setup Workspace and Owner
      const { user: owner, workspace } = await createWorkspaceWithOwner();
      
      // 2. Create a Project for the team
      const project = await createProject(workspace.id, owner.id);
      
      // 3. Invite a new member
      const member = await createUser();
      const inviteRes = await request(app)
        .post(`/api/v1/workspaces/${workspace.id}/invite`)
        .set(await authWithCsrfHeaders(owner))
        .send({ email: member.email, role: 'MEMBER' });
      
      expect(inviteRes.status).toBe(201);
      const inviteToken = inviteRes.body.data.token;
      
      // 4. Member accepts invitation
      const acceptRes = await request(app)
        .post(`/api/v1/workspaces/invitations/${inviteToken}/accept`)
        .set(await authWithCsrfHeaders(member));
      
      expect(acceptRes.status).toBe(200);
      
      // 5. Member creates a task in the team project
      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set(await authWithCsrfHeaders(member))
        .send({
          title: 'Collaborative Task',
          projectId: project.id
        });
      
      expect(taskRes.status).toBe(201);
      expect(taskRes.body.data.createdById).toBe(member.id);
      
      // 6. Owner verifies the task exists
      const verifyRes = await request(app)
        .get(`/api/v1/tasks/${taskRes.body.data.id}`)
        .set(authHeaders(owner));
      
      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.title).toBe('Collaborative Task');
    });
  });

  describe('Journey 3: The Productivity Cycle', () => {
    it('should follow a task from creation to completion', async () => {
      const { user, workspace } = await createWorkspaceWithOwner();
      const project = await createProject(workspace.id, user.id);
      
      // 1. Create Task
      const taskRes = await request(app)
        .post('/api/v1/tasks')
        .set(await authWithCsrfHeaders(user))
        .send({
          title: 'Critical Bug Fix',
          projectId: project.id,
          priority: Priority.HIGH
        });
      const taskId = taskRes.body.data.id;
      
      // 2. Move to In Progress
      const progressRes = await request(app)
        .patch(`/api/v1/tasks/${taskId}/status`)
        .set(await authWithCsrfHeaders(user))
        .send({ status: TaskStatus.IN_PROGRESS });
      
      expect(progressRes.status).toBe(200);
      expect(progressRes.body.data.status).toBe(TaskStatus.IN_PROGRESS);
      
      // 3. Mark as Completed
      const completeRes = await request(app)
        .patch(`/api/v1/tasks/${taskId}/status`)
        .set(await authWithCsrfHeaders(user))
        .send({ status: TaskStatus.COMPLETED });
      
      expect(completeRes.status).toBe(200);
      expect(completeRes.body.data.status).toBe(TaskStatus.COMPLETED);
      
      // 4. Verify completion timestamp in DB
      const dbTask = await prisma.task.findUnique({ where: { id: taskId } });
      expect(dbTask?.completedAt).not.toBeNull();
    });
  });

  describe('Journey 4: Communication & Management', () => {
    it('should allow owner to post an announcement and members to see it', async () => {
      const { user: owner, workspace } = await createWorkspaceWithOwner();
      
      // 1. Owner posts announcement
      const announceRes = await request(app)
        .post(`/api/v1/workspaces/${workspace.slug}/announcements`)
        .set(await authWithCsrfHeaders(owner))
        .send({
          title: 'Welcome to the Team',
          content: 'We are excited to have you all here!',
        });

      expect(announceRes.status).toBe(201);
      const announcementId = announceRes.body.data.id;

      // 2. Member joins and reads it
      const member = await createUser();
      await addMemberToWorkspace(member.id, workspace.id, WorkspaceRole.MEMBER);

      const listRes = await request(app)
        .get(`/api/v1/workspaces/${workspace.slug}/announcements`)
        .set(authHeaders(member));
      
      expect(listRes.status).toBe(200);
      const announcements = listRes.body.data;
      expect(announcements.some((a: any) => a.id === announcementId)).toBe(true);
    });
  });
});
