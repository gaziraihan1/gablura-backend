import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  createWorkspaceWithOwner,
} from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';

// Helper: valid query params
function validRange(workspaceId?: string) {
  return {
    workspaceId,
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date().toISOString(),
  };
}
beforeEach(() => {
  process.env.ENFORCE_CSRF_IN_TESTS = 'true';
});
afterAll(() => {
  delete process.env.ENFORCE_CSRF_IN_TESTS;
})

// ─────────────────────────────────────────────────────────────
// GET /api/calendar/aggregates
// ─────────────────────────────────────────────────────────────
describe('GET /api/calendar/aggregates', () => {
  it('200 — returns aggregates for user', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/calendar/aggregates')
      .set(authHeaders(user))
      .query(validRange(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('400 — invalid query (missing dates)', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/calendar/aggregates')
      .set(authHeaders(user))
      .query({}); // invalid

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/calendar/aggregates');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/calendar/insights
// ─────────────────────────────────────────────────────────────
describe('GET /api/calendar/insights', () => {
  it('200 — returns insights', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/calendar/insights')
      .set(authHeaders(user))
      .query(validRange(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalPlannedHours');
    expect(res.body.data).toHaveProperty('burnoutRisk');
  });

  it('400 — invalid query', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/calendar/insights')
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/calendar/system-events
// ─────────────────────────────────────────────────────────────
describe('GET /api/calendar/system-events', () => {
  it('200 — returns events list', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/calendar/system-events')
      .set(authHeaders(user))
      .query(validRange(workspace.id));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get('/api/calendar/system-events');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/calendar/goals
// ─────────────────────────────────────────────────────────────
describe('GET /api/calendar/goals', () => {
  it('200 — returns goal checkpoints', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get('/api/calendar/goals')
      .set(authHeaders(user))
      .query(validRange(workspace.id));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/calendar/goals
// ─────────────────────────────────────────────────────────────
describe('POST /api/calendar/goals', () => {
  it('201 — creates goal checkpoint', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const payload = {
      workspaceId: workspace.id,
      title: 'Finish MVP',
      type: 'WEEKLY',
      targetDate: new Date().toISOString(),
    };

    const res = await request(app)
      .post('/api/calendar/goals')
      .set(await authWithCsrfHeaders(user))
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe(payload.title);

    const goal = await prisma.goalCheckpoint.findUnique({
      where: { id: res.body.data.id },
    });

    expect(goal).not.toBeNull();
    expect(goal?.userId).toBe(user.id);
  });

  it('400 — validation error', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post('/api/calendar/goals')
      .set(await authWithCsrfHeaders(user))
      .send({ title: '' }); // invalid

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app)
      .post('/api/calendar/goals')
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/calendar/recalculate
// ─────────────────────────────────────────────────────────────
describe('POST /api/calendar/recalculate', () => {
  it('200 — recalculates aggregate', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post('/api/calendar/recalculate')
      .set(await authWithCsrfHeaders(user))
      .send({
        workspaceId: workspace.id,
        date: new Date().toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('400 — invalid body', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post('/api/calendar/recalculate')
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/calendar/initialize
// ─────────────────────────────────────────────────────────────
describe('POST /api/calendar/initialize', () => {
  it('200 — initializes user settings', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post('/api/calendar/initialize')
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const capacity = await prisma.userCapacity.findUnique({
      where: { userId: user.id },
    });

    const schedule = await prisma.userWorkSchedule.findUnique({
      where: { userId: user.id },
    });

    expect(capacity).not.toBeNull();
    expect(schedule).not.toBeNull();
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).post('/api/calendar/initialize');
    expect(res.status).toBe(401);
  });
});