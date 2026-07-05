import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'task-test-user-id',
      email: 'task-test@example.com',
      role: 'ADMIN',
      name: 'Task Tester',
    };
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

vi.mock('../../../modules/billing/index.js', () => ({
  requireWorkspaceCreationSlot: (req: any, res: any, next: any) => next(),
  requireMemberSlot: (req: any, res: any, next: any) => next(),
  requireProjectSlot: (req: any, res: any) => next(),
}));

// --- Contract Schemas ---

const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  priority: z.string(),
  startDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  estimatedHours: z.number().nullable().optional(),
  actualHours: z.number().nullable().optional(),
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  projectId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  createdById: z.string(),
});

const TaskStatsSchema = z.object({
  personal: z.number(),
  assigned: z.number(),
  created: z.number(),
  overdue: z.number(),
  dueToday: z.number(),
  totalTasks: z.number(),
  inProgress: z.number(),
  completed: z.number(),
  byStatus: z.object({
    TODO: z.number().optional(),
    IN_PROGRESS: z.number().optional(),
    IN_REVIEW: z.number().optional(),
    BLOCKED: z.number().optional(),
    COMPLETED: z.number().optional(),
    CANCELLED: z.number().optional(),
  }),
});

const TaskQuotaSchema = z.object({
  current: z.number().optional(),
  limit: z.number().optional(),
  percentage: z.number().optional(),
});

// --- Tests ---

describe('Task API Contract Tests', () => {
  let app: any;
  const testUserId = 'task-test-user-id';

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ensureUserExists = async () => {
    await prisma.user.upsert({
      where: { email: 'task-test@example.com' },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: 'task-test@example.com',
        password: 'password123',
        name: 'Task Tester',
        emailVerified: new Date(),
      },
    });
  };

  describe('Read Operations', () => {
    let testWorkspaceId: string;
    let testWorkspaceSlug: string;
    let testProjectId: string;
    let testTaskId: string;

    beforeEach(async () => {
      await ensureUserExists();

      const workspace = await prisma.workspace.create({
        data: {
          name: 'Task Test Workspace',
          slug: `task-ws-${Date.now()}`,
          ownerId: testUserId,
          members: {
            create: { userId: testUserId, role: 'OWNER' },
          },
        },
      });
      testWorkspaceId = workspace.id;
      testWorkspaceSlug = workspace.slug;

      const project = await prisma.project.create({
        data: {
          name: 'Task Test Project',
          slug: `task-proj-${Date.now()}`,
          workspaceId: testWorkspaceId,
          workspaceSlug: testWorkspaceSlug,
          createdById: testUserId,
          status: 'ACTIVE',
          priority: 'MEDIUM',
        },
      });
      testProjectId = project.id;

      const task = await prisma.task.create({
        data: {
          title: 'Contract Test Task',
          projectId: testProjectId,
          workspaceId: testWorkspaceId,
          createdById: testUserId,
          status: 'TODO',
          priority: 'MEDIUM',
        },
      });
      testTaskId = task.id;
    });

    it('GET /tasks should match the contract', async () => {
      const response = await request(app).get('/api/v1/tasks');
      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      
      const data = response.body.data;
      expect(Array.isArray(data)).toBe(true);
      if (data.length > 0) {
        validateContract(TaskSchema, data[0]);
      }
    });

    it('GET /tasks/:id should match the contract', async () => {
      const response = await request(app).get(`/api/v1/tasks/${testTaskId}`);
      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(TaskSchema, response.body.data);
    });

    it('GET /tasks/stats should match the contract', async () => {
      const response = await request(app).get('/api/v1/tasks/stats');
      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(TaskStatsSchema, response.body.data);
    });

    it('GET /tasks/quota/personal should match the contract', async () => {
      const response = await request(app).get('/api/v1/tasks/quota/personal');
      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(TaskQuotaSchema, response.body.data);
    });
  });

  describe('Write Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
    });

    it('POST /tasks should return a valid task on creation', async () => {
      const workspace = await prisma.workspace.create({
        data: {
          name: 'Task Creation Workspace',
          slug: `task-create-ws-${Date.now()}`,
          ownerId: testUserId,
          members: {
            create: { userId: testUserId, role: 'OWNER' },
          },
        },
      });

      const response = await request(app)
        .post('/api/v1/tasks')
        .send({
          title: 'New Contract Task',
          workspaceId: workspace.id,
          status: 'TODO',
          priority: 'LOW',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(TaskSchema, response.body.data);
    });
  });
});
