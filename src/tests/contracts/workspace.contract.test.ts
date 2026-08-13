import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      email: 'contract-test@example.com',
      role: 'ADMIN',
      name: 'Contract Tester',
    };
    next();
  },
}));

// The workspace router now enforces CSRF on mutating routes (like every other
// module). Contract tests focus on the response shape, not security posture,
// so they bypass the middleware exactly like the other contract suites.
vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

vi.mock('../../../modules/billing/plan.middleware.js', () => ({
  planGuard: () => (req: any, res: any, next: any) => next(),
  requireWorkspaceCreationSlot: (req: any, res: any, next: any) => next(),
  requireMemberSlot: (req: any, res: any, next: any) => next(),
}));

vi.mock('../../../modules/billing/index.js', () => ({
  requireWorkspaceCreationSlot: (req: any, res: any, next: any) => next(),
  requireMemberSlot: (req: any, res: any, next: any) => next(),
  requireMemberSlotForInvitation: (req: any, res: any, next: any) => next(),
}));


// --- Contract Schemas ---

const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  logo: z.string().nullable(),
  isPublic: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const WorkspaceStatsSchema = z.object({
  totalProjects: z.number(),
  totalTasks: z.number(),
  totalMembers: z.number(),
  completedTasks: z.number(),
  overdueTasks: z.number(),
  completionRate: z.number(),
});

const WorkspaceOverviewSchema = z.object({
  workspace: WorkspaceSchema,
  stats: WorkspaceStatsSchema,
  projects: z.array(z.any()), // Simplified for now
});

// --- Tests ---

describe('Workspace API Contract Tests', () => {
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

  describe('Read Operations', () => {
    let testWorkspaceId: string;
    let testWorkspaceSlug: string;

    beforeEach(async () => {
      await ensureUserExists();

      const workspace = await prisma.workspace.create({
        data: {
          name: 'Contract Test Workspace',
          slug: `contract-test-${Date.now()}`,
          ownerId: testUserId,
          members: {
            create: {
              userId: testUserId,
              role: 'OWNER',
            },
          },
        },
      });
      testWorkspaceId = workspace.id;
      testWorkspaceSlug = workspace.slug;
    });

    it('GET /workspaces should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/workspaces');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      
      const data = response.body.data;
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        validateContract(WorkspaceSchema, data[0]);
      }
    });

    it('GET /workspaces/:slug should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspaceSlug}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(WorkspaceSchema, response.body.data);
    });

    it('GET /workspaces/:id/stats should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspaceId}/stats`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(WorkspaceStatsSchema, response.body.data);
    });

    it('GET /workspaces/:slug/overview should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspaceSlug}/overview`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(WorkspaceOverviewSchema, response.body.data);
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /workspaces should return a valid workspace on creation', async () => {
      const response = await request(app)
        .post('/api/v1/workspaces')
        .send({
          name: 'New Contract Workspace',
          description: 'Testing creation contract',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(WorkspaceSchema, response.body.data);
    });
  });
});
