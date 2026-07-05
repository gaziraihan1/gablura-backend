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

describe('DailyTask API Contract Tests', () => {
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

  const DailyTaskResponseSchema = z.object({
    date: z.string(),
    primaryTask: z.any().nullable(),
    secondaryTasks: z.array(z.any()),
  });

  const DailyTaskSchema = z.object({
    id: z.string(),
    userId: z.string(),
    taskId: z.string(),
    type: z.string(), // DailyTaskType enum
    date: z.string(),
  });

  const DailyTaskStatsSchema = z.object({
    totalDays: z.number(),
    primaryTasksSet: z.number(),
    secondaryTasksSet: z.number(),
    primaryTasksCompleted: z.number(),
    secondaryTasksCompleted: z.number(),
    primaryCompletionRate: z.number(),
    secondaryCompletionRate: z.number(),
  });

  describe('Read Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('GET /daily-tasks should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/daily-tasks');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(DailyTaskResponseSchema, response.body.data);
    });

    it('GET /daily-tasks/stats should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/daily-tasks/stats');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(DailyTaskStatsSchema, response.body.data);
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /daily-tasks should return a valid daily task on creation', async () => {
      const task = await prisma.task.create({
        data: {
          title: 'Contract Test Task',
          createdById: testUserId,
        },
      });

      const response = await request(app)
        .post('/api/v1/daily-tasks')
        .send({
          taskId: task.id,
          type: 'PRIMARY',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(DailyTaskSchema, response.body.data);
    });

    it('DELETE /daily-tasks/:taskId should return success', async () => {
      const task = await prisma.task.create({
        data: {
          title: 'Contract Test Task to Delete',
          createdById: testUserId,
        },
      });

      const dailyTask = await prisma.dailyTask.create({
        data: {
          userId: testUserId,
          taskId: task.id,
          type: 'PRIMARY',
          date: new Date(),
        },
      });

      const response = await request(app)
        .delete(`/api/v1/daily-tasks/${dailyTask.taskId}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /daily-tasks/clear-expired should return a valid result', async () => {
      const response = await request(app)
        .post('/api/v1/daily-tasks/clear-expired');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(response.body.data).toHaveProperty('deletedCount');
    });
  });
});
