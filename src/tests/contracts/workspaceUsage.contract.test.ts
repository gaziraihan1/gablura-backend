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

describe('Workspace Usage API Contract Tests', () => {
  let app: any;
  let testUser: any;
  let testWorkspace: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    const { user, workspace } = await createWorkspaceWithOwner();
    testUser = user;
    testWorkspace = workspace;
    (global as any).testUser = testUser;
  });

  describe('Usage Reports', () => {
    it('GET /workspace-usage/:workspaceId/usage should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspace-usage/${testWorkspace.id}/usage`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
