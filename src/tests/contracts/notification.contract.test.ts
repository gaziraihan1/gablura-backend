import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: 'USER',
      name: 'Test User',
      sessionId: 'test-session-id',
    };
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Notification API Contract Tests', () => {
  let app: any;
  let testUser: any;

  beforeEach(async () => {
    await prisma.user.upsert({
      where: { email: 'test@example.com' },
      update: {},
      create: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        password: 'password',
      },
    });
    testUser = await prisma.user.findUnique({
      where: { id: 'test-user-id' },
    });
  });

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const NotificationSchema = z.object({
    id: z.string(),
    userId: z.string(),
    type: z.string(),
    title: z.string(),
    message: z.string(),
    actionUrl: z.string().nullable(),
    read: z.boolean(),
    createdAt: z.string(),
  });

  const NotificationListSchema = z.object({
    items: z.array(NotificationSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });

  describe('Read Operations', () => {
    it('GET /notifications should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/notifications');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(NotificationListSchema, response.body.data);
    });

    it('GET /notifications/unread-count should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/notifications/unread-count');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(response.body.data).toHaveProperty('count');
      expect(typeof response.body.data.count).toBe('number');
    });
  });

  describe('Write Operations', () => {
    it('PATCH /notifications/:id/read should match the contract', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUser.id,
          type: 'TASK_ASSIGNED',
          title: 'Contract Test',
          message: 'Content',
          read: false,
        },
      });

      const response = await request(app)
        .patch(`/api/v1/notifications/${notification.id}/read`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('PATCH /notifications/read-all should match the contract', async () => {
      const response = await request(app)
        .patch('/api/v1/notifications/read-all');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /notifications/read/all should match the contract', async () => {
      const response = await request(app)
        .delete('/api/v1/notifications/read/all');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /notifications/:id should match the contract', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUser.id,
          type: 'TASK_ASSIGNED',
          title: 'Contract Test',
          message: 'Content',
          read: false,
        },
      });

      const response = await request(app)
        .delete(`/api/v1/notifications/${notification.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
