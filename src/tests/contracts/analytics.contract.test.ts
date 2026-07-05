import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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

describe('Analytics API Contract Tests', () => {
  let app: any;
  let testWorkspaceId: string;
  const testUserId = 'test-user-id';

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    // Ensure user exists
    await prisma.user.upsert({
      where: { email: 'test@example.com' },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
        emailVerified: new Date(),
      },
    });

    // Create a PRO workspace
    const workspace = await prisma.workspace.create({
      data: {
        name: 'Analytics Test Workspace',
        slug: `analytics-test-${Date.now()}`,
        ownerId: testUserId,
        plan: 'PRO',
        members: {
          create: {
            userId: testUserId,
            role: 'OWNER',
          },
        },
      },
    });

    testWorkspaceId = workspace.id;
  });

  describe('Analytics Reports', () => {
    it('GET /analytics/:workspaceId/overview should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/overview`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /analytics/:workspaceId/tasks/trends should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/tasks/trends`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /analytics/:workspaceId/projects/health should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/projects/health`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /analytics/:workspaceId/members/contribution should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/members/contribution`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /analytics/:workspaceId/time/summary should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/time/summary`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /analytics/:workspaceId/activity/trends should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/activity/trends`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /analytics/:workspaceId/workload should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/${testWorkspaceId}/workload`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
