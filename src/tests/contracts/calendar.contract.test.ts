import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      email: 'contract-test@example.com',
      role: 'USER',
      name: 'Contract Tester',
      sessionId: 'test-session-id',
    };
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Calendar API Contract Tests', () => {
  let app: any;
  const testUserId = 'test-user-id';

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ensureUserExists = async () => {
    await prisma.user.upsert({
      where: { email: 'contract-test@example.com' },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: 'contract-test@example.com',
        password: 'password123',
        name: 'Contract Tester',
        emailVerified: new Date(),
      },
    });
  };

  const CalendarDayAggregateSchema = z.object({
    id: z.string(),
    userId: z.string(),
    date: z.string(),
    totalTasks: z.number(),
    dueTasks: z.number(),
    criticalTasks: z.number(),
    milestoneCount: z.number(),
    plannedHours: z.number(),
    actualHours: z.number(),
    focusMinutes: z.number(),
    workloadScore: z.number(),
    overCapacity: z.boolean(),
    hasPrimaryFocus: z.boolean(),
    isReviewDay: z.boolean(),
    updatedAt: z.string(),
  });

  const CalendarInsightsSchema = z.object({
    totalPlannedHours: z.number(),
    totalCapacityHours: z.number(),
    commitmentGap: z.number(),
    overloadedDays: z.number(),
    focusDays: z.number(),
    burnoutRisk: z.string(),
    timeAllocation: z.object({
      deepWork: z.number(),
      meetings: z.number(),
      admin: z.number(),
      learning: z.number(),
    }).nullable(),
  });

  const GoalCheckpointSchema = z.object({
    id: z.string(),
    userId: z.string(),
    workspaceId: z.string().nullable(),
    title: z.string(),
    type: z.string(),
    targetDate: z.string(),
    completed: z.boolean(),
    createdAt: z.string(),
  });

  const SystemCalendarEventSchema = z.object({
    id: z.string(),
    userId: z.string().nullable(),
    workspaceId: z.string().nullable(),
    title: z.string(),
    type: z.string(),
    date: z.string(),
    recurring: z.boolean(),
    createdAt: z.string(),
  });

  describe('Read Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('GET /calendar/aggregates should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/calendar/aggregates')
        .query({ startDate: new Date().toISOString(), endDate: new Date().toISOString() });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(CalendarDayAggregateSchema, response.body.data[0]);
      }
    });

    it('GET /calendar/insights should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/calendar/insights')
        .query({ startDate: new Date().toISOString(), endDate: new Date().toISOString() });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(CalendarInsightsSchema, response.body.data);
    });

    it('GET /calendar/system-events should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/calendar/system-events')
        .query({ startDate: new Date().toISOString(), endDate: new Date().toISOString() });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(SystemCalendarEventSchema, response.body.data[0]);
      }
    });

    it('GET /calendar/goals should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/calendar/goals')
        .query({ startDate: new Date().toISOString(), endDate: new Date().toISOString() });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(GoalCheckpointSchema, response.body.data[0]);
      }
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /calendar/goals should return a valid goal checkpoint', async () => {
      const response = await request(app)
        .post('/api/v1/calendar/goals')
        .send({
          title: 'Finish Contract Testing',
          type: 'WEEKLY',
          targetDate: new Date(),
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(GoalCheckpointSchema, response.body.data);
    });

    it('POST /calendar/recalculate should return success', async () => {
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Recalc Workspace',
          slug: `recalc-ws-${Date.now()}`,
          ownerId: testUserId,
          members: { create: { userId: testUserId, role: 'OWNER' } },
        },
      });

      const response = await request(app)
        .post('/api/v1/calendar/recalculate')
        .send({
          workspaceId: workspace.id,
          date: new Date().toISOString(),
        });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /calendar/initialize should return success', async () => {
      const response = await request(app)
        .post('/api/v1/calendar/initialize');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
