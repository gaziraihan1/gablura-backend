import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';
import { createWorkspaceWithOwner } from '../factories/index.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if ((global as any).testUser) {
      req.user = (global as any).testUser;
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

describe('Storage API Contract Tests', () => {
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

  describe('Storage Info Operations', () => {
    it('GET /storage/workspaces should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/storage/workspaces');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('GET /storage/:workspaceId/overview should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/storage/${testWorkspace.id}/overview`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /storage/:workspaceId/info should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/storage/${testWorkspace.id}/info`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /storage/:workspaceId/my-contribution should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/storage/${testWorkspace.id}/my-contribution`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /storage/:workspaceId/user-contributions should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/storage/${testWorkspace.id}/user-contributions`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /storage/:workspaceId/largest-files should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/storage/${testWorkspace.id}/largest-files`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });

  describe('Storage Write Operations', () => {
    it('POST /storage/:workspaceId/bulk-delete should return success', async () => {
      const files = await prisma.file.createMany({
        data: [
          {
            name: 'file1.txt',
            originalName: 'file1.txt',
            size: 1024,
            mimeType: 'text/plain',
            url: 'http://test.com/file1.txt',
            uploadedById: testUser.id,
            workspaceId: testWorkspace.id,
          },
          {
            name: 'file2.txt',
            originalName: 'file2.txt',
            size: 2048,
            mimeType: 'text/plain',
            url: 'http://test.com/file2.txt',
            uploadedById: testUser.id,
            workspaceId: testWorkspace.id,
          },
        ],
      });

      // In some databases, createMany doesn't return IDs. We need to fetch them.
      const createdFiles = await prisma.file.findMany({
        where: { workspaceId: testWorkspace.id, originalName: { in: ['file1.txt', 'file2.txt'] } },
        select: { id: true },
      });
      const fileIds = createdFiles.map(f => f.id);

      const response = await request(app)
        .post(`/api/v1/storage/${testWorkspace.id}/bulk-delete`)
        .send({ fileIds });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /storage/files/:fileId should return success', async () => {
      const file = await prisma.file.create({
        data: {
          name: 'delete-me.txt',
          originalName: 'delete-me.txt',
          size: 512,
          mimeType: 'text/plain',
          url: 'http://test.com/delete-me.txt',
          uploadedById: testUser.id,
          workspaceId: testWorkspace.id,
        },
      });

      const response = await request(app)
        .delete(`/api/v1/storage/files/${file.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /storage/:workspaceId/check-upload should return success', async () => {

      const response = await request(app)
        .post(`/api/v1/storage/${testWorkspace.id}/check-upload`)
        .send({ fileName: 'test.pdf', fileSize: 1024 });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
