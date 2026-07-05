import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { createWorkspaceWithOwner } from '../factories/index.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (global.testUser) {
      req.user = global.testUser;
    } else {
      req.user = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'USER',
        name: 'Test User',
        sessionId: 'test-session-id',
      };
    }
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('User API Contract Tests', () => {
  let app: any;
  let testUser: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    const { user } = await createWorkspaceWithOwner();
    testUser = user;
    (global as any).testUser = testUser;
  });

  const UserProfileSchema = z.object({
    id: z.string(),
    name: z.string().nullable(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string(),
    createdAt: z.string(),
  });

  describe('Profile Operations', () => {
    it('GET /user/profile should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/user/profile');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(UserProfileSchema, response.body.data.user);
    });

    it('PUT /user/profile should return success on update', async () => {
      const response = await request(app)
        .put('/api/v1/user/profile')
        .send({
          name: 'Updated Name',
        });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(UserProfileSchema, response.body.data.user);
    });
  });

  describe('Workspace Operations', () => {
    it('GET /user/workspace-members should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/user/workspace-members');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(UserProfileSchema, response.body.data[0]);
      }
    });
  });
});
