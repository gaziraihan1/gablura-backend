import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createLabel,
  createTask,
} from '../factories/index.js';

// Shared state for the mock authentication
const mockUser = {
  id: 'pending',
  email: 'pending@example.com',
  role: 'USER',
  name: 'Pending User',
  sessionId: 'test-session-id',
};

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Label API Contract Tests', () => {
  let app: any;
  let testUser: any;
  let testWorkspace: any;
  let testProject: any;

  const LabelSchema = z.object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    workspaceId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
  });

  beforeAll(async () => {
// ... (rest of the file)
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    // Setup test data for every test to avoid issues with global afterEach truncation
    const { user, workspace } = await createWorkspaceWithOwner();
    testUser = user;
    testWorkspace = workspace;

    // Update the shared mock user
    Object.assign(mockUser, {
      id: testUser.id,
      email: testUser.email,
      role: testUser.role,
      name: testUser.name,
    });

    testProject = await createProject(
      testWorkspace.id,
      testUser.id,
      { name: 'Test Project' }
    );
  });

  describe('Read Operations', () => {
    it('GET /labels should match the contract', async () => {
      // Ensure at least one label exists
      await createLabel(testWorkspace.id, testUser.id, {
        name: 'Contract Label',
        color: '#FF0000',
      });

      const response = await request(app)
        .get('/api/v1/labels');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(LabelSchema, response.body.data[0]);
      }
    });

    it('GET /labels/popular should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/labels/popular');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /labels/:id should match the contract', async () => {
      const label = await createLabel(testWorkspace.id, testUser.id, {
        name: 'Read Label',
        color: '#00FF00',
      });

      const response = await request(app)
        .get(`/api/v1/labels/${label.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(LabelSchema, response.body.data);
    });

    it('GET /labels/:id/tasks should match the contract', async () => {
      const label = await createLabel(testWorkspace.id, testUser.id, {
        name: 'Tasks Label',
        color: '#0000FF',
      });

      const response = await request(app)
        .get(`/api/v1/labels/${label.id}/tasks`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });

  describe('Write Operations', () => {
    it('POST /labels should return success', async () => {
      const response = await request(app)
        .post('/api/v1/labels')
        .send({
          name: 'New Label',
          color: '#00FF00',
          workspaceId: testWorkspace.id,
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
    });

    it('PATCH /labels/:id should return success', async () => {
      const label = await createLabel(testWorkspace.id, testUser.id, {
        name: 'Update Label',
        color: '#FFFF00',
      });

      const response = await request(app)
        .patch(`/api/v1/labels/${label.id}`)
        .send({
          name: 'Updated Label Name',
        });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /labels/:id should return success', async () => {
      const label = await createLabel(testWorkspace.id, testUser.id, {
        name: 'Delete Label',
        color: '#FFFFFF',
      });

      const response = await request(app)
        .delete(`/api/v1/labels/${label.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /labels/:labelId/tasks/:taskId should return success', async () => {
      const label = await createLabel(testWorkspace.id, testUser.id, {
        name: 'Link Label',
        color: '#000000',
      });
      const task = await createTask(testProject.id, testUser.id, {
        title: 'Linked Task',
        workspaceId: testWorkspace.id,
      });

      const response = await request(app)
        .post(`/api/v1/labels/${label.id}/tasks/${task.id}`);

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /labels/:labelId/tasks/:taskId should return success', async () => {
      const label = await createLabel(testWorkspace.id, testUser.id, {
        name: 'Unlink Label',
        color: '#000000',
      });
      const task = await createTask(testProject.id, testUser.id, {
        title: 'Unlinked Task',
        workspaceId: testWorkspace.id,
      });

      const response = await request(app)
        .post(`/api/v1/labels/${label.id}/tasks/${task.id}`);
      
      const deleteResponse = await request(app)
        .delete(`/api/v1/labels/${label.id}/tasks/${task.id}`);

      expect(deleteResponse.status).toBe(200);
      validateContract(APIResponseSchema, deleteResponse.body);
    });
  });
});
