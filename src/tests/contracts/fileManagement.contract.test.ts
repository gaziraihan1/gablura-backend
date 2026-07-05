import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

// Dynamic user state for mocks
let mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  role: 'USER',
  name: 'Test User',
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

describe('File Management API Contract Tests', () => {
  let app: any;
  let testWorkspaceId: string;

  beforeEach(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;

    // Cleanup and setup for each test to ensure isolation
    await prisma.file.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();

    const user = await prisma.user.create({
      data: {
        email: `fm-test-${Math.random()}@example.com`,
        name: 'File Management Test User',
        role: 'SUPER_ADMIN',
      },
    });
    
    mockUser = {
      id: user.id,
      email: user.email,
      role: 'SUPER_ADMIN',
      name: user.name,
      sessionId: 'fm-session-id',
    };

    const workspace = await prisma.workspace.create({
      data: {
        name: 'File Management Test Workspace',
        slug: `fm-test-ws-${Math.random()}`,
        ownerId: user.id,
      },
    });
    testWorkspaceId = workspace.id;

    await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: testWorkspaceId,
        role: 'OWNER',
      },
    });
  });

  describe('File Operations', () => {
    it('GET /file-management/:workspaceId/files should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/file-management/${testWorkspaceId}/files`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(response.body.data).toHaveProperty('files');
      expect(Array.isArray(response.body.data.files)).toBe(true);
    });

    it('DELETE /file-management/:workspaceId/files/:fileId should return success', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'temp.txt',
          originalName: 'temp.txt',
          size: 100,
          mimeType: 'text/plain',
          url: 'http://example.com/temp.txt',
          workspaceId: testWorkspaceId,
          uploadedById: mockUser.id,
        },
      });

      const response = await request(app)
        .delete(`/api/v1/file-management/${testWorkspaceId}/files/${file.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /file-management/:workspaceId/stats should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/file-management/${testWorkspaceId}/stats`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /file-management/:workspaceId/uploaders should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/file-management/${testWorkspaceId}/uploaders`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
