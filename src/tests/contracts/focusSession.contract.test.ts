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

describe('FocusSession API Contract Tests', () => {
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

  const FocusSessionSchema = z.object({
    id: z.string(),
    duration: z.number(),
    type: z.string(), // FocusType enum
    completed: z.boolean(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    userId: z.string(),
    taskId: z.string().nullable(),
  });

  const FocusStatsSchema = z.object({
    totalSessions: z.number(),
    totalMinutes: z.number(),
    completedToday: z.number(),
    averageSessionLength: z.number(),
    focusStreak: z.number().optional(),
  });

  describe('Read Operations', () => {
    let testSessionId: string;

    beforeEach(async () => {
      await ensureUserExists();
      const session = await prisma.focusSession.create({
        data: {
          userId: testUserId,
          duration: 25,
          type: 'POMODORO',
          completed: false,
          startedAt: new Date(),
        },
      });
      testSessionId = session.id;
    });

    it('GET /focus-sessions/active should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/focus-sessions/active');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      if (response.body.data) {
        validateContract(FocusSessionSchema, response.body.data);
      }
    });

    it('GET /focus-sessions/history should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/focus-sessions/history');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(FocusSessionSchema, response.body.data[0]);
      }
    });

    it('GET /focus-sessions/stats should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/focus-sessions/stats');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(FocusStatsSchema, response.body.data);
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /focus-sessions/start should return a valid session on creation', async () => {
      const response = await request(app)
        .post('/api/v1/focus-sessions/start')
        .send({
          duration: 25,
          type: 'POMODORO',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(FocusSessionSchema, response.body.data);
    });

    it('POST /focus-sessions/:id/complete should return a valid session', async () => {
      const session = await prisma.focusSession.create({
        data: {
          userId: testUserId,
          duration: 25,
          type: 'POMODORO',
          startedAt: new Date(),
        },
      });

      const response = await request(app)
        .post(`/api/v1/focus-sessions/${session.id}/complete`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(FocusSessionSchema, response.body.data);
    });

    it('POST /focus-sessions/:id/cancel should return a success response', async () => {
      const session = await prisma.focusSession.create({
        data: {
          userId: testUserId,
          duration: 25,
          type: 'POMODORO',
          startedAt: new Date(),
        },
      });

      const response = await request(app)
        .post(`/api/v1/focus-sessions/${session.id}/cancel`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
