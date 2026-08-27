import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { validateContract, APIResponseSchema } from '../contracts/contract.util.js';
import {
  projectListResponseSchema,
  workspaceProjectListResponseSchema,
  projectDetailSchema,
  mutatedProjectSchema,
} from '../../lib/contracts/project.contract.js';
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
  requireMemberSlotForInvitation: (req: any, res: any, next: any) => next(),
  requireProjectSlot: (req: any, res: any, next: any) => next(),
}));

// --- Contract Schemas ---
// Canonical wire contracts live in src/lib/contracts/project.contract.ts and
// are imported below — this file only ENFORCES them against live responses.

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

      // Canonical wire contract — enforced for EVERY item in the list.
      // Source of truth: src/lib/contracts/project.contract.ts
      validateContract(projectListResponseSchema, response.body);
    });

    it('GET /projects/workspace/:workspaceId should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/workspace/${testWorkspaceId}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(workspaceProjectListResponseSchema, response.body);
    });

    it('GET /projects/slug/:slug should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/slug/${testProjectSlug}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(projectDetailSchema, response.body.data);
    });

    it('GET /projects/:projectId should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/projects/${testProjectId}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(projectDetailSchema, response.body.data);
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
      validateContract(mutatedProjectSchema, response.body.data);
    });
  });
});
