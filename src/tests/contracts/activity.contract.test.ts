import { describe, it, expect, beforeAll, vi } from 'vitest';
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

describe('Activity API Contract Tests', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ActivitySchema = z.object({
    id: z.string(),
    userId: z.string(),
    action: z.string(),
    entityId: z.string(),
    entityType: z.string(),
    metadata: z.any().optional(),
    workspaceId: z.string(),
    workspaceSlug: z.string(),
    createdAt: z.string(),
  });

  describe('Read Operations', () => {
    it('GET /activities should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/activities');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(ActivitySchema, response.body.data[0]);
      }
    });

    it('GET /activities/workspace/:workspaceId should match the contract', async () => {
      // Ensure user exists first to satisfy workspace ownerId constraint
      await prisma.user.upsert({
        where: { email: 'test@example.com' },
        update: {},
        create: {
          email: 'test@example.com',
          id: 'test-user-id',
          name: 'Test User',
        },
      });

      // Ensure workspace exists and user has access
      await prisma.workspace.upsert({
        where: { slug: 'test-workspace-slug' },
        update: {},
        create: {
          name: 'Test Workspace',
          slug: 'test-workspace-slug',
          id: 'test-workspace-id',
          ownerId: 'test-user-id',
        },
      });

      const response = await request(app)
        .get('/api/v1/activities/workspace/test-workspace-id');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(ActivitySchema, response.body.data[0]);
      }
    });

    it('GET /activities/task/:taskId should match the contract', async () => {
      // Ensure user, workspace, project and task exist
      await prisma.user.upsert({
        where: { email: 'test@example.com' },
        update: {},
        create: {
          email: 'test@example.com',
          id: 'test-user-id',
          name: 'Test User',
        },
      });

      await prisma.workspace.upsert({
        where: { slug: 'test-workspace-slug' },
        update: {},
        create: {
          name: 'Test Workspace',
          slug: 'test-workspace-slug',
          id: 'test-workspace-id',
          ownerId: 'test-user-id',
        },
      });

      const project = await prisma.project.upsert({
        where: {
          workspaceId_slug: {
            workspaceId: 'test-workspace-id',
            slug: 'test-project-slug',
          },
        },
        update: {},
        create: {
          name: 'Test Project',
          slug: 'test-project-slug',
          workspaceId: 'test-workspace-id',
          workspaceSlug: 'test-workspace-slug',
          createdById: 'test-user-id',
        },
      });

      const task = await prisma.task.upsert({
        where: { id: 'test-task-id' },
        update: {},
        create: {
          title: 'Test Task',
          createdById: 'test-user-id',
          workspaceId: 'test-workspace-id',
          projectId: project.id,
        },
      });

      const response = await request(app)
        .get(`/api/v1/activities/task/${task.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(ActivitySchema, response.body.data[0]);
      }
    });
  });

  describe('Write Operations', () => {
    it('DELETE /activities/clear should return success', async () => {
      const response = await request(app)
        .delete('/api/v1/activities/clear');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /activities/:activityId should return success', async () => {
      // Ensure user and workspace exist to satisfy foreign key constraints
      await prisma.user.upsert({
        where: { email: 'test@example.com' },
        update: {},
        create: {
          email: 'test@example.com',
          id: 'test-user-id',
          name: 'Test User',
        },
      });

      await prisma.workspace.upsert({
        where: { slug: 'test-workspace-slug' },
        update: {},
        create: {
          name: 'Test Workspace',
          slug: 'test-workspace-slug',
          id: 'test-workspace-id',
          ownerId: 'test-user-id',
        },
      });

      const activity = await prisma.activity.create({
        data: {
          userId: 'test-user-id',
          action: 'UPDATED',
          entityId: 'test-entity',
          entityType: 'TASK',
          workspaceId: 'test-workspace-id',
          workspaceSlug: 'test-workspace-slug',
        },
      });

      const response = await request(app)
        .delete(`/api/v1/activities/${activity.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
