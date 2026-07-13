// src/tests/integration/calendar/calendar.integration.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for GET|POST /api/v1/calendar/* routes.
// Kept separate from the existing calendar.test.ts so both files can coexist.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createTask,
} from '../factories/index.js';
import { authHeaders, authWithCsrfHeaders } from '../helpers/auth.js';
import { normalizeDate } from '../../modules/calendar/calendar.utils.js';

const BASE = '/api/v1/calendar';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rangeQuery(workspaceId?: string, daysBack = 7) {
  return {
    ...(workspaceId ? { workspaceId } : {}),
    startDate: new Date(Date.now() - daysBack * 86_400_000).toISOString(),
    endDate:   new Date().toISOString(),
  };
}

beforeEach(() => { process.env.ENFORCE_CSRF_IN_TESTS = 'true'; });
afterEach(() => { delete process.env.ENFORCE_CSRF_IN_TESTS; });

// ─────────────────────────────────────────────────────────────────────────────
// GET /aggregates
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/aggregates', () => {
  it('200 — returns array of aggregates for authenticated user', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('200 — works without workspaceId (personal calendar)', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query(rangeQuery(undefined));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('200 — response includes correct aggregate shape', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id, 1));

    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      const agg = res.body.data[0];
      expect(agg).toHaveProperty('userId');
      expect(agg).toHaveProperty('date');
      expect(agg).toHaveProperty('plannedHours');
      expect(agg).toHaveProperty('overCapacity');
      expect(agg).toHaveProperty('workloadScore');
    }
  });

  it('200 — aggregates are ordered by date ascending', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id, 3));

    expect(res.status).toBe(200);
    const dates = res.body.data.map((a: any) => new Date(a.date).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
    }
  });

  it('200 — isolation: aggregates belong to the requesting user only', async () => {
    const { user, workspace }      = await createWorkspaceWithOwner();
    const { user: other }          = await createWorkspaceWithOwner();

    // Trigger computation for both users
    await request(app).get(`${BASE}/aggregates`).set(authHeaders(user)).query(rangeQuery(workspace.id));
    await request(app).get(`${BASE}/aggregates`).set(authHeaders(other)).query(rangeQuery());

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.body.data.every((a: any) => a.userId === user.id)).toBe(true);
  });

  it('400 — missing startDate and endDate', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });

  it('400 — invalid date format', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/aggregates`)
      .set(authHeaders(user))
      .query({ startDate: 'not-a-date', endDate: 'also-not' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/aggregates`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /insights
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/insights', () => {
  it('200 — returns insights with correct top-level fields', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/insights`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      totalPlannedHours:  expect.any(Number),
      totalCapacityHours: expect.any(Number),
      commitmentGap:      expect.any(Number),
      overloadedDays:     expect.any(Number),
      focusDays:          expect.any(Number),
      burnoutRisk:        expect.any(String),
    });
  });

  it('200 — burnoutRisk is a valid level', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/insights`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(['LOW', 'MODERATE', 'HIGH', 'CRITICAL']).toContain(res.body.data.burnoutRisk);
  });

  it('200 — overloadedDays increases when tasks exceed daily capacity', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const today = normalizeDate(new Date());

    await createTask(workspace.id, user.id, { estimatedHours: 5, dueDate: today });
    await createTask(workspace.id, user.id, { estimatedHours: 5, dueDate: today });

    const res = await request(app)
      .get(`${BASE}/insights`)
      .set(authHeaders(user))
      .query({
        workspaceId: workspace.id,
        startDate:   today.toISOString(),
        endDate:     new Date().toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.overloadedDays).toBeGreaterThanOrEqual(1);
  });

  it('400 — missing date range', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/insights`)
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/insights`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /system-events
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/system-events', () => {
  it('200 — returns an array (empty or populated)', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/system-events`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('200 — returns only events for the querying user or workspace', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    // Seed a system event directly
    await prisma.systemCalendarEvent.create({
      data: {
        userId:      user.id,
        workspaceId: workspace.id,
        title:       'Test Event',
        date:        new Date(),
        type:        'WORKSPACE_REVIEW',
      },
    });

    const res = await request(app)
      .get(`${BASE}/system-events`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.data.some((e: any) => e.title === 'Test Event')).toBe(true);
  });

  it('400 — missing date params', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/system-events`)
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/system-events`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /goals
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/goals', () => {
  it('200 — returns goal checkpoints in date order', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    // Seed two goals in range
    await prisma.goalCheckpoint.createMany({
      data: [
        {
          userId:      user.id,
          workspaceId: workspace.id,
          title:       'Early Goal',
          type:        'WEEKLY',
          targetDate:  new Date(Date.now() - 3 * 86_400_000),
        },
        {
          userId:      user.id,
          workspaceId: workspace.id,
          title:       'Later Goal',
          type:        'MONTHLY',
          targetDate:  new Date(),
        },
      ],
    });

    const res = await request(app)
      .get(`${BASE}/goals`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);

    const dates = res.body.data.map((g: any) => new Date(g.targetDate).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeGreaterThanOrEqual(dates[i - 1]);
    }
  });

  it('200 — workspace isolation: only returns own workspace goals', async () => {
    const { user, workspace }        = await createWorkspaceWithOwner();
    const { user: other, workspace: otherWs } = await createWorkspaceWithOwner();

    await prisma.goalCheckpoint.create({
      data: { userId: user.id, workspaceId: workspace.id, title: 'Mine', type: 'WEEKLY', targetDate: new Date() },
    });
    await prisma.goalCheckpoint.create({
      data: { userId: other.id, workspaceId: otherWs.id, title: 'Theirs', type: 'WEEKLY', targetDate: new Date() },
    });

    const res = await request(app)
      .get(`${BASE}/goals`)
      .set(authHeaders(user))
      .query(rangeQuery(workspace.id));

    expect(res.status).toBe(200);
    expect(res.body.data.every((g: any) => g.userId === user.id)).toBe(true);
    expect(res.body.data.some((g: any) => g.title === 'Theirs')).toBe(false);
  });

  it('400 — missing date params', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/goals`)
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/goals`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /goals
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/calendar/goals', () => {
  it('201 — creates a goal checkpoint and persists it', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/goals`)
      .set(await authWithCsrfHeaders(user))
      .send({
        workspaceId: workspace.id,
        title:       'Ship v1.0',
        type:        'WEEKLY',
        targetDate:  new Date().toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Ship v1.0');
    expect(res.body.data.userId).toBe(user.id);

    const db = await prisma.goalCheckpoint.findUnique({ where: { id: res.body.data.id } });
    expect(db).not.toBeNull();
    expect(db?.userId).toBe(user.id);
  });

  it('201 — accepts all valid type values', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    const types = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'KPI'] as const;

    for (const type of types) {
      const res = await request(app)
        .post(`${BASE}/goals`)
        .set(await authWithCsrfHeaders(user))
        .send({ workspaceId: workspace.id, title: `${type} goal`, type, targetDate: new Date().toISOString() });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe(type);
    }
  });

  it('201 — creates goal without workspaceId (personal)', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/goals`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Personal goal', type: 'MONTHLY', targetDate: new Date().toISOString() });

    expect(res.status).toBe(201);
    expect(res.body.data.workspaceId).toBeNull();
  });

  it('400 — empty title is rejected', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/goals`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: '', type: 'WEEKLY', targetDate: new Date().toISOString() });

    expect(res.status).toBe(400);
  });

  it('400 — invalid type enum is rejected', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/goals`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Goal', type: 'INVALID', targetDate: new Date().toISOString() });

    expect(res.status).toBe(400);
  });

  it('400 — missing targetDate is rejected', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/goals`)
      .set(await authWithCsrfHeaders(user))
      .send({ title: 'Goal', type: 'WEEKLY' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).post(`${BASE}/goals`).send({});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /recalculate
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/calendar/recalculate', () => {
  it('200 — triggers recalculation and creates/updates an aggregate row', async () => {
    const { user, workspace } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/recalculate`)
      .set(await authWithCsrfHeaders(user))
      .send({ workspaceId: workspace.id, date: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const agg = await prisma.calendarDayAggregate.findFirst({
      where: { userId: user.id },
    });
    expect(agg).not.toBeNull();
  });

  it('200 — works without workspaceId', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/recalculate`)
      .set(await authWithCsrfHeaders(user))
      .send({ date: new Date().toISOString() });

    expect(res.status).toBe(200);
  });

  it('400 — missing date', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/recalculate`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(400);
  });

  it('400 — invalid date string', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/recalculate`)
      .set(await authWithCsrfHeaders(user))
      .send({ date: 'not-a-date' });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).post(`${BASE}/recalculate`).send({});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /initialize
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/calendar/initialize', () => {
  it('200 — creates UserCapacity and UserWorkSchedule for new user', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/initialize`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const capacity = await prisma.userCapacity.findUnique({ where: { userId: user.id } });
    const schedule = await prisma.userWorkSchedule.findUnique({ where: { userId: user.id } });

    expect(capacity).not.toBeNull();
    expect(schedule).not.toBeNull();
    expect(capacity?.weeklyHours).toBe(40);
    expect(capacity?.dailyCapacityHours).toBe(8);
    expect(schedule?.workDays).toHaveLength(5);
  });

  it('200 — idempotent: calling twice does not duplicate records', async () => {
    const { user } = await createWorkspaceWithOwner();

    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user));
    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user));

    const capacityCount = await prisma.userCapacity.count({ where: { userId: user.id } });
    const scheduleCount = await prisma.userWorkSchedule.count({ where: { userId: user.id } });

    expect(capacityCount).toBe(1);
    expect(scheduleCount).toBe(1);
  });

  it('200 — different users get independent settings', async () => {
    const { user: user1 } = await createWorkspaceWithOwner();
    const { user: user2 } = await createWorkspaceWithOwner();

    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user1));
    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user2));

    const c1 = await prisma.userCapacity.findUnique({ where: { userId: user1.id } });
    const c2 = await prisma.userCapacity.findUnique({ where: { userId: user2.id } });

    expect(c1?.userId).toBe(user1.id);
    expect(c2?.userId).toBe(user2.id);
    expect(c1?.userId).not.toBe(c2?.userId);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).post(`${BASE}/initialize`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /capacity
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/capacity', () => {
  it('200 — returns null capacity before initialization', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/capacity`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeNull();
  });

  it('200 — returns capacity after initialization', async () => {
    const { user } = await createWorkspaceWithOwner();

    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user));

    const res = await request(app)
      .get(`${BASE}/capacity`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      weeklyHours: 40,
      dailyCapacityHours: 8,
      deepWorkHours: 4,
    });
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/capacity`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /capacity
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/calendar/capacity', () => {
  it('200 — updates capacity fields', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`${BASE}/capacity`)
      .set(await authWithCsrfHeaders(user))
      .send({ weeklyHours: 30, dailyCapacityHours: 6 });

    expect(res.status).toBe(200);
    expect(res.body.data.weeklyHours).toBe(30);
    expect(res.body.data.dailyCapacityHours).toBe(6);
  });

  it('200 — partial update', async () => {
    const { user } = await createWorkspaceWithOwner();
    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user));

    const res = await request(app)
      .put(`${BASE}/capacity`)
      .set(await authWithCsrfHeaders(user))
      .send({ deepWorkHours: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.deepWorkHours).toBe(2);
    expect(res.body.data.weeklyHours).toBe(40);
  });

  it('400 — zero weeklyHours', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`${BASE}/capacity`)
      .set(await authWithCsrfHeaders(user))
      .send({ weeklyHours: 0 });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).put(`${BASE}/capacity`).send({});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /schedule
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/schedule', () => {
  it('200 — returns null schedule before initialization', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/schedule`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('200 — returns schedule after initialization', async () => {
    const { user } = await createWorkspaceWithOwner();
    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user));

    const res = await request(app)
      .get(`${BASE}/schedule`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.workDays).toHaveLength(5);
    expect(res.body.data.workStartHour).toBe(9);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/schedule`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /schedule
// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/calendar/schedule', () => {
  it('200 — updates schedule fields', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`${BASE}/schedule`)
      .set(await authWithCsrfHeaders(user))
      .send({ workDays: ['MON', 'WED', 'FRI'], workStartHour: 10, workEndHour: 18 });

    expect(res.status).toBe(200);
    expect(res.body.data.workDays).toEqual(['MON', 'WED', 'FRI']);
    expect(res.body.data.workStartHour).toBe(10);
    expect(res.body.data.workEndHour).toBe(18);
  });

  it('200 — partial update preserves existing fields', async () => {
    const { user } = await createWorkspaceWithOwner();
    await request(app).post(`${BASE}/initialize`).set(await authWithCsrfHeaders(user));

    const res = await request(app)
      .put(`${BASE}/schedule`)
      .set(await authWithCsrfHeaders(user))
      .send({ timezone: 'Europe/London' });

    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe('Europe/London');
    expect(res.body.data.workDays).toHaveLength(5);
  });

  it('400 — invalid work day value', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .put(`${BASE}/schedule`)
      .set(await authWithCsrfHeaders(user))
      .send({ workDays: ['INVALID'] });

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).put(`${BASE}/schedule`).send({});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /energy?date=
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/energy', () => {
  it('200 — returns null for date with no entry', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/energy`)
      .set(authHeaders(user))
      .query({ date: new Date().toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it('200 — returns energy level for logged date', async () => {
    const { user } = await createWorkspaceWithOwner();
    const today = new Date().toISOString();

    await request(app)
      .post(`${BASE}/energy`)
      .set(await authWithCsrfHeaders(user))
      .send({ date: today, energyLevel: 7 });

    const res = await request(app)
      .get(`${BASE}/energy`)
      .set(authHeaders(user))
      .query({ date: today });

    expect(res.status).toBe(200);
    expect(res.body.data.energyLevel).toBe(7);
  });

  it('400 — missing date', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/energy`)
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/energy`).query({ date: new Date().toISOString() });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /energy
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/calendar/energy', () => {
  it('201 — logs energy level', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/energy`)
      .set(await authWithCsrfHeaders(user))
      .send({ date: new Date().toISOString(), energyLevel: 8, note: 'Focused' });

    expect(res.status).toBe(201);
    expect(res.body.data.energyLevel).toBe(8);
    expect(res.body.data.note).toBe('Focused');
  });

  it('201 — upserts energy on same date', async () => {
    const { user } = await createWorkspaceWithOwner();
    const date = new Date().toISOString();

    await request(app)
      .post(`${BASE}/energy`)
      .set(await authWithCsrfHeaders(user))
      .send({ date, energyLevel: 3 });

    const res = await request(app)
      .post(`${BASE}/energy`)
      .set(await authWithCsrfHeaders(user))
      .send({ date, energyLevel: 9, note: 'Updated' });

    expect(res.status).toBe(201);
    expect(res.body.data.energyLevel).toBe(9);
  });

  it('400 — energyLevel out of range', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/energy`)
      .set(await authWithCsrfHeaders(user))
      .send({ date: new Date().toISOString(), energyLevel: 15 });

    expect(res.status).toBe(400);
  });

  it('400 — missing required fields', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .post(`${BASE}/energy`)
      .set(await authWithCsrfHeaders(user))
      .send({});

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).post(`${BASE}/energy`).send({});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /energy/history
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/energy/history', () => {
  it('200 — returns paginated energy history', async () => {
    const { user } = await createWorkspaceWithOwner();
    const today = new Date();

    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      await prisma.energyLevel.create({
        data: { userId: user.id, date: d, energyLevel: 5 + i },
      });
    }

    const res = await request(app)
      .get(`${BASE}/energy/history`)
      .set(authHeaders(user))
      .query({
        startDate: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        endDate: today.toISOString(),
        page: 1,
        limit: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toMatchObject({
      page: 1,
      limit: 3,
      total: 5,
      totalPages: 2,
      hasNext: true,
      hasPrev: false,
    });
  });

  it('200 — returns empty history with pagination metadata', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/energy/history`)
      .set(authHeaders(user))
      .query({
        startDate: new Date('2020-01-01').toISOString(),
        endDate: new Date('2020-01-31').toISOString(),
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(0);
  });

  it('400 — missing startDate or endDate', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/energy/history`)
      .set(authHeaders(user))
      .query({});

    expect(res.status).toBe(400);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/energy/history`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /burnout-trends
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/burnout-trends', () => {
  it('200 — returns empty array when no signals exist', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/burnout-trends`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('200 — returns burnout signals when data exists', async () => {
    const { user } = await createWorkspaceWithOwner();

    await prisma.burnoutSignal.create({
      data: {
        userId: user.id,
        weekStart: new Date(),
        riskLevel: 'MODERATE',
        consecutiveHeavyDays: 2,
        avgDailyLoad: 0.8,
      },
    });

    const res = await request(app)
      .get(`${BASE}/burnout-trends`)
      .set(authHeaders(user))
      .query({ weeks: 4 });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('riskLevel');
    expect(res.body.data[0]).toHaveProperty('weekStart');
  });

  it('200 — defaults weeks to 4', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/burnout-trends`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/burnout-trends`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /recommendations
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/calendar/recommendations', () => {
  it('200 — returns focus suggestion for new users', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .get(`${BASE}/recommendations`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('type');
    expect(res.body.data[0]).toHaveProperty('message');
    expect(res.body.data[0]).toHaveProperty('priority');
  });

  it('200 — returns non-dismissed recommendations', async () => {
    const { user } = await createWorkspaceWithOwner();

    await prisma.wellnessRecommendation.create({
      data: {
        userId: user.id,
        type: 'FOCUS_SUGGESTION',
        message: 'Do a pomodoro',
        priority: 50,
      },
    });

    const res = await request(app)
      .get(`${BASE}/recommendations`)
      .set(authHeaders(user));

    expect(res.status).toBe(200);
    expect(res.body.data.some((r: any) => r.message === 'Do a pomodoro')).toBe(true);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).get(`${BASE}/recommendations`);
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /recommendations/:id/dismiss
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/calendar/recommendations/:id/dismiss', () => {
  it('200 — dismisses own recommendation', async () => {
    const { user } = await createWorkspaceWithOwner();

    const rec = await prisma.wellnessRecommendation.create({
      data: { userId: user.id, type: 'BREAK_REMINDER', message: 'Rest', priority: 50 },
    });

    const res = await request(app)
      .patch(`${BASE}/recommendations/${rec.id}/dismiss`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);

    const db = await prisma.wellnessRecommendation.findUnique({ where: { id: rec.id } });
    expect(db?.dismissed).toBe(true);
  });

  it('200 — silently ignores non-existent id', async () => {
    const { user } = await createWorkspaceWithOwner();

    const res = await request(app)
      .patch(`${BASE}/recommendations/non-existent-id/dismiss`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(200);
  });

  it('403 — cannot dismiss another user recommendation', async () => {
    const { user } = await createWorkspaceWithOwner();
    const { user: other } = await createWorkspaceWithOwner();

    const rec = await prisma.wellnessRecommendation.create({
      data: { userId: other.id, type: 'FOCUS_SUGGESTION', message: 'Focus', priority: 50 },
    });

    const res = await request(app)
      .patch(`${BASE}/recommendations/${rec.id}/dismiss`)
      .set(await authWithCsrfHeaders(user));

    expect(res.status).toBe(403);
  });

  it('401 — unauthenticated', async () => {
    const res = await request(app).patch(`${BASE}/recommendations/some-id/dismiss`);
    expect(res.status).toBe(401);
  });
});