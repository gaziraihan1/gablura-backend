import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner, cleanAllTestData } from '../factories/index.js';
import { authWithCsrfHeaders, authHeaders } from '../helpers/auth.js';

describe('📅 Daily Tasks & Labels E2E', () => {
  let user: any;
  let headers: any;
  let workspace: any;

  beforeEach(async () => {
    await cleanAllTestData();
    const setup = await createWorkspaceWithOwner();
    user = setup.user;
    workspace = setup.workspace;
    headers = await authWithCsrfHeaders(user);
  });

  it('should complete the "Daily Tasks" lifecycle', async () => {
    // 1. Create a task via API
    const taskRes = await request(app)
      .post('/api/v1/tasks')
      .set(headers)
      .send({ title: 'Important Task', workspaceId: workspace.id });

    expect(taskRes.status).toBe(201);
    const task = taskRes.body.data;

    // 2. Add task as PRIMARY daily task (returns 201)
    const addRes = await request(app)
      .post('/api/v1/daily-tasks')
      .set(headers)
      .send({ taskId: task.id, type: 'PRIMARY' });

    expect(addRes.status).toBe(201);

    // 3. Get daily tasks for today
    const today = new Date().toISOString().split('T')[0];
    const listRes = await request(app)
      .get(`/api/v1/daily-tasks?date=${today}`)
      .set(authHeaders(user));

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toBeDefined();
    expect(listRes.body.data.primaryTask).not.toBeNull();

    // 4. Add a SECONDARY task
    const task2Res = await request(app)
      .post('/api/v1/tasks')
      .set(headers)
      .send({ title: 'Secondary Task', workspaceId: workspace.id });
    const task2 = task2Res.body.data;

    const add2Res = await request(app)
      .post('/api/v1/daily-tasks')
      .set(headers)
      .send({ taskId: task2.id, type: 'SECONDARY' });

    expect(add2Res.status).toBe(201);

    // 5. Remove the secondary task
    const removeRes = await request(app)
      .delete(`/api/v1/daily-tasks/${task2.id}`)
      .set(headers)
      .query({ date: today });

    expect(removeRes.status).toBe(200);
  });

  it('should complete the "Label Management" lifecycle', async () => {
    // 1. Create a label
    const createRes = await request(app)
      .post('/api/v1/labels')
      .set(headers)
      .send({ name: 'Bug', color: '#ef4444', workspaceId: workspace.id });

    expect(createRes.status).toBe(201);
    const label = createRes.body.data;

    // 2. List labels
    const listRes = await request(app)
      .get(`/api/v1/labels?workspaceId=${workspace.id}`)
      .set(authHeaders(user));

    expect(listRes.status).toBe(200);

    // 3. Get label by ID
    const getRes = await request(app)
      .get(`/api/v1/labels/${label.id}`)
      .set(authHeaders(user));

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.name).toBe('Bug');

    // 4. Update label
    const updateRes = await request(app)
      .patch(`/api/v1/labels/${label.id}`)
      .set(headers)
      .send({ name: 'Critical Bug', color: '#dc2626' });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.name).toBe('Critical Bug');

    // 5. Delete label
    const deleteRes = await request(app)
      .delete(`/api/v1/labels/${label.id}`)
      .set(headers);

    expect(deleteRes.status).toBe(200);
  });
});

describe('🎯 Focus Session E2E', () => {
  let user: any;
  let headers: any;

  beforeEach(async () => {
    await cleanAllTestData();
    const setup = await createWorkspaceWithOwner();
    user = setup.user;
    headers = await authWithCsrfHeaders(user);
  });

  it('should complete the "Focus Session" lifecycle', async () => {
    // 1. Start a focus session
    const startRes = await request(app)
      .post('/api/v1/focus-sessions/start')
      .set(headers)
      .send({ type: 'POMODORO', duration: 25 });

    expect(startRes.status).toBe(201);

    // 2. Get active session
    const activeRes = await request(app)
      .get('/api/v1/focus-sessions/active')
      .set(authHeaders(user));

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data).not.toBeNull();

    // 3. Complete the session
    const sessionId = startRes.body.data.id;
    const completeRes = await request(app)
      .post(`/api/v1/focus-sessions/${sessionId}/complete`)
      .set(headers);

    expect(completeRes.status).toBe(200);

    // 4. Get history
    const historyRes = await request(app)
      .get('/api/v1/focus-sessions/history')
      .set(authHeaders(user));

    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.length).toBeGreaterThanOrEqual(1);

    // 5. Get stats
    const statsRes = await request(app)
      .get('/api/v1/focus-sessions/stats')
      .set(authHeaders(user));

    expect(statsRes.status).toBe(200);
  });

  it('should prevent starting two active sessions', async () => {
    await request(app)
      .post('/api/v1/focus-sessions/start')
      .set(headers)
      .send({ type: 'POMODORO', duration: 25 });

    const secondRes = await request(app)
      .post('/api/v1/focus-sessions/start')
      .set(headers)
      .send({ type: 'DEEP_WORK', duration: 60 });

    expect(secondRes.status).toBe(409);
  });
});
