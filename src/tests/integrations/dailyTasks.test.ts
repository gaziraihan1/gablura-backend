import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { createWorkspaceWithOwner } from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';

// Helper: valid date
const todayISO = () => new Date().toISOString();

beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = 'true';
});
afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
})

// ─────────────────────────────────────────────────────────────
// GET /api/daily-tasks
// ─────────────────────────────────────────────────────────────
describe('GET /api/daily-tasks', () => {
  it('200 — returns daily tasks', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/daily-tasks')
      .set(authHeaders(user))
      .query({ date: todayISO() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('primaryTask');
    expect(res.body.data).toHaveProperty('secondaryTasks');
  });

  it('400 — invalid query', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/daily-tasks')
      .set(authHeaders(user))
      .query({ date: 'invalid-date' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/daily-tasks');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/daily-tasks
// ─────────────────────────────────────────────────────────────
describe('POST /api/daily-tasks', () => {
  it('201 — adds daily task', async () => {
    const { user } = await createWorkspaceWithOwner();

    // Create a task first
    const task = await prisma.task.create({
      data: {
        title: 'Test Task',
        createdById: user.id,
      },
    });

    const res = await request(app)
      .post('/api/daily-tasks')
      .set(await authWithCsrfHeaders(user))
      .send({
        taskId: task.id,
        type: 'PRIMARY', // assuming enum allows PRIMARY/SECONDARY
        date: todayISO(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.taskId).toBe(task.id);
  });

  it('409 — cannot add second primary task', async () => {
    const { user } = await createWorkspaceWithOwner();

    const task1 = await prisma.task.create({
      data: { title: 'Task 1', createdById: user.id },
    });

    const task2 = await prisma.task.create({
      data: { title: 'Task 2', createdById: user.id },
    });

    await request(app)
      .post('/api/daily-tasks')
      .set(await authWithCsrfHeaders(user))
      .send({
        taskId: task1.id,
        type: 'PRIMARY',
        date: todayISO(),
      });

    const res = await request(app)
      .post('/api/daily-tasks')
      .set(await authWithCsrfHeaders(user))
      .send({
        taskId: task2.id,
        type: 'PRIMARY',
        date: todayISO(),
      });

    expect(res.status).toBe(409);
  });

  it('400 — validation error', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post('/api/daily-tasks')
      .set(await authWithCsrfHeaders(user))
      .send({}); // invalid

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app)
      .post('/api/daily-tasks')
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/daily-tasks/:taskId
// ─────────────────────────────────────────────────────────────
describe('DELETE /api/daily-tasks/:taskId', () => {
  it('200 — removes daily task', async () => {
    const { user } = await createWorkspaceWithOwner();

    const task = await prisma.task.create({
      data: {
        title: 'Task to remove',
        createdById: user.id,
      },
    });

    await prisma.dailyTask.create({
      data: {
        userId: user.id,
        taskId: task.id,
        type: 'SECONDARY',
        date: new Date(),
      },
    });

    const res = await request(app)
      .delete(`/api/daily-tasks/${task.id}`)
      .set(await authWithCsrfHeaders(user))
      .query({ date: todayISO() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('404 — task not found', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .delete('/api/daily-tasks/non-existing-id')
      .set(await authWithCsrfHeaders(user))
      .query({ date: todayISO() });

    expect(res.status).toBe(404);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app)
      .delete('/api/daily-tasks/123');

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/daily-tasks/clear-expired
// ─────────────────────────────────────────────────────────────
describe('POST /api/daily-tasks/clear-expired', () => {
  it('200 — clears expired tasks', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post('/api/daily-tasks/clear-expired')
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('deletedCount');
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app)
      .post('/api/daily-tasks/clear-expired');

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/daily-tasks/stats
// ─────────────────────────────────────────────────────────────
describe('GET /api/daily-tasks/stats', () => {
  it('200 — returns stats', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/daily-tasks/stats')
      .set(authHeaders(user))
      .query({
        startDate: new Date(Date.now() - 7 * 86400000).toISOString(),
        endDate: todayISO(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('400 — invalid query', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/daily-tasks/stats')
      .set(authHeaders(user))
      .query({ startDate: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app)
      .get('/api/daily-tasks/stats');

    expect(res.status).toBe(401);
  });
});