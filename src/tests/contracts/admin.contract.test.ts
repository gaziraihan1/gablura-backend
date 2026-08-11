import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-admin-id',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
      name: 'Super Admin',
      sessionId: 'admin-session-id',
    };
    next();
  },
}));

vi.mock('../../middleware/focuraAdmin.js', () => ({
  requireFocuraAdmin: (req: any, res: any, next: any) => next(),
}));

vi.mock('../../config/admin.config.js', () => ({
  isFocuraAdmin: vi.fn((userId: string) => userId === 'test-admin-id'),
  isFocuraAdminUser: vi.fn((role: string, userId: string) => userId === 'test-admin-id'),
  getFocuraAdminIds: vi.fn(() => ['test-admin-id']),
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Admin API Contract Tests', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const AdminStatsSchema = z.object({
    totals: z.object({
      users: z.number(),
      workspaces: z.number(),
      projects: z.number(),
      tasks: z.number(),
      announcements: z.number(),
      meetings: z.number(),
    }),
    plans: z.array(z.object({
      plan: z.string(),
      count: z.number(),
    })),
    featureRequests: z.object({
      pending: z.number(),
      approved: z.number(),
      planned: z.number(),
      completed: z.number(),
      rejected: z.number(),
    }),
    totalStorageUsedMb: z.number(),
    growth: z.array(z.object({
      label: z.string(),
      users: z.number(),
      workspaces: z.number(),
      projects: z.number(),
    })),
    taskActivity: z.array(z.object({
      label: z.string(),
      todo: z.number(),
      inProgress: z.number(),
      completed: z.number(),
    })),
    growthByPlan: z.array(z.object({
      label: z.string(),
      FREE: z.number(),
      PRO: z.number(),
      BUSINESS: z.number(),
      ENTERPRISE: z.number(),
    })),
    recentSignups: z.array(z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
      createdAt: z.string(),
    })),
    recentWorkspaces: z.array(z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      plan: z.string(),
      createdAt: z.string(),
      owner: z.object({ id: z.string(), name: z.string(), email: z.string() }),
      _count: z.object({ members: z.number(), projects: z.number() }),
    })),
  });

  const AdminUserSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string(),
    createdAt: z.string(),
    lastLoginAt: z.string().nullable(),
    _count: z.object({
      ownedWorkspaces: z.number(),
      workspaceMember: z.number(),
      createdTasks: z.number(),
      comments: z.number(),
      focusSessions: z.number(),
      featureRequests: z.number(),
    }),
  });

  const AdminWorkspaceSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    plan: z.string(),
    createdAt: z.string(),
    maxMembers: z.number(),
    maxStorageMb: z.number(),
    usedStorageMb: z.number(),
    owner: z.object({ id: z.string(), name: z.string(), email: z.string(), image: z.string().nullable() }),
    subscription: z.object({
      status: z.string(),
      billingCycle: z.string(),
      currentPeriodEnd: z.string(),
      cancelAtPeriodEnd: z.boolean(),
      planName: z.string(),
      monthlyPriceCents: z.number(),
    }).nullable(),
    _count: z.object({ members: z.number(), projects: z.number(), tasks: z.number() }),
  });

  describe('Read Operations', () => {
    it('GET /admin/stats should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/admin/stats');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(AdminStatsSchema, response.body.data);
    });

    it('GET /admin/users should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/admin/users');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(AdminUserSchema, response.body.data[0]);
      }
    });

    it('GET /admin/workspaces should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/admin/workspaces');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(AdminWorkspaceSchema, response.body.data[0]);
      }
    });
  });

  describe('Write Operations', () => {
    it('PATCH /admin/users/:id/ban should return success', async () => {
      // Create a user to ban
      const user = await prisma.user.create({
        data: {
          email: 'ban-me@example.com',
          password: 'password123',
          name: 'Ban Me',
        },
      });

      const response = await request(app)
        .patch(`/api/v1/admin/users/${user.id}/ban`)
        .send({ reason: 'Violating terms' });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('PATCH /admin/users/:id/unban should return success', async () => {
      const user = await prisma.user.findFirst({
        where: { email: 'ban-me@example.com' },
      });

      if (user) {
        const response = await request(app)
          .patch(`/api/v1/admin/users/${user.id}/unban`);

        expect(response.status).toBe(200);
        validateContract(APIResponseSchema, response.body);
      }
    });
  });
});
