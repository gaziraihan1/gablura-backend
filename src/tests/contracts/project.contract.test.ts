import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from '../contracts/contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      email: 'project-test@example.com',
      role: 'ADMIN',
      name: 'Project Tester',
    };
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any, next: any) => next(),
}));

vi.mock('../../../modules/billing/plan.middleware.js', () => ({
  planGuard: () => (req: any, res: any, next: any) => next(),
  requireWorkspaceCreationSlot: (req: any, res: any, next: any) => next(),
  requireMemberSlot: (req: any, res: any, next: any) => next(),
  requireProjectSlot: (req: any, res: any, next: any) => next(),
}));

vi.mock('../../../modules/billing/index.js', () => ({
  requireWorkspaceCreationSlot: (req: any, res: any, next: any) => next(),
  requireMemberSlot: (req: any, res: any, next: any) => next(),
  requireProjectSlot: (req: any, res: any, next: any) => next(),
}));

// --- Contract Schemas ---

const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable().optional(),
  status: z.string(),
  priority: z.string(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable(),
  workspaceId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

// const ProjectStatsSchema = z.object({
//   totalTasks: z.number(),
//   completedTasks: z.number(),
//   inProgressTasks: z.number(),
//   overdueTasks: z.number(),
//   totalMembers: z.number(),
//   projectDays: z.number(),
//   topPerformer: z.object({
//     id: z.string(),
//     name: z.string().nullable(),
//     email: z.string(),
//     image: z.string().nullable(),
//   }).nullable(),
// });

// --- Tests ---

describe('Project API Contract Tests', () => {
  let app: any;
  const testUserId = 'test-user-id';

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ensureUserExists = async () => {
    await prisma.user.upsert({
      where: { email: 'project-test@example.com' },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: 'project-test@example.com',
        password: 'password123',
        name: 'Project Tester',
        emailVerified: new Date(),
      },
    });
  };

  describe('Read Operations', () => {
    let testWorkspaceId: string;
    let testProjectId: string;
    let testProjectSlug: string;

    beforeEach(async () => {
      await ensureUserExists();

      const workspace = await prisma.workspace.create({
        data: {
          name: 'Project Test Workspace',
          slug: `proj-test-${Date.now()}`,
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

      const project = await prisma.project.create({
        data: {
          name: 'Contract Test Project',
          slug: `proj-contract-${Date.now()}`,
          workspace: {
            connect: {
              id_slug: {
                id: testWorkspaceId,
                slug: workspace.slug,
              },
            },
          },
          status: 'ACTIVE',
          priority: 'MEDIUM',
          createdBy: { connect: { id: testUserId } },
        },
      });
      testProjectId = project.id;
      testProjectSlug = project.slug;
    });

    it('GET /projects/user/all should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/projects/user/all');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      
      const data = response.body.data;
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        validateContract(ProjectSchema, data[0]);
      }
    });

    it('GET /projects/workspace/:workspaceId should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/workspace/${testWorkspaceId}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      
      const data = response.body.data;
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        validateContract(ProjectSchema, data[0]);
      }
    });

    it('GET /projects/slug/:slug should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/slug/${testProjectSlug}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(ProjectSchema, response.body.data);
    });

    it('GET /projects/:projectId should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${testProjectId}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(ProjectSchema, response.body.data);
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /projects should return a valid project on creation', async () => {
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Creation Test Workspace',
          slug: `creation-test-${Date.now()}`,
          ownerId: testUserId,
          members: {
            create: {
              userId: testUserId,
              role: 'OWNER',
            },
          },
        },
      });

      const response = await request(app)
        .post('/api/v1/projects')
        .send({
          name: 'New Contract Project',
          workspaceId: workspace.id,
          createdById: testUserId,
          status: 'PLANNING',
          priority: 'LOW',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(ProjectSchema, response.body.data);
    });
  });
});
