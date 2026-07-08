import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { 
  createWorkspaceWithOwner 
} from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';

describe('🛠️ Advanced Task Management Journeys', () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
  });

  it('should handle the "Subtask Hierarchy" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a parent task
     * 2. User creates multiple subtasks for that task
     * 3. User updates a subtask status
     * 4. User verifies subtask stats
     * 5. User deletes a subtask
     */
    const headers = await authWithCsrfHeaders(testUser);

    // 1. Parent Task
    const projRes = await request(app).post('/api/v1/projects').set(headers).send({ name: 'Subtask Project', workspaceId: testWorkspace.id });
    const project = projRes.body.data;
    const taskRes = await request(app).post('/api/v1/tasks').set(headers).send({ title: 'Parent Task', projectId: project.id, workspaceId: testWorkspace.id });
    const task = taskRes.body.data;

    // 2. Create Subtasks
    const sub1Res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .set(headers)
      .send({ title: 'Subtask 1', description: 'First bit of work' });
    expect(sub1Res.status).toBe(201);
    const sub1 = sub1Res.body.data;

    const sub2Res = await request(app)
      .post(`/api/v1/tasks/${task.id}/subtasks`)
      .set(headers)
      .send({ title: 'Subtask 2', description: 'Second bit of work' });
    expect(sub2Res.status).toBe(201);
    const sub2 = sub2Res.body.data;

    // 3. Update Subtask Status
    const updateRes = await request(app)
      .patch(`/api/v1/tasks/${task.id}/subtasks/${sub1.id}/status`)
      .set(headers)
      .send({ status: 'COMPLETED' });
    expect(updateRes.status).toBe(200);

    // 4. Verify Stats
    const statsRes = await request(app)
      .get(`/api/v1/tasks/${task.id}/subtasks/stats`)
      .set(headers);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data.completed).toBe(1);
    expect(statsRes.body.data.total).toBe(2);

    // 5. Delete Subtask
    const delRes = await request(app)
      .delete(`/api/v1/tasks/${task.id}/subtasks/${sub2.id}`)
      .set(headers);
    expect(delRes.status).toBe(200);

    const finalStatsRes = await request(app)
      .get(`/api/v1/tasks/${task.id}/subtasks/stats`)
      .set(headers);
    expect(finalStatsRes.body.data.total).toBe(1);
  });
});
