import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import {
  createUser,
  createWorkspaceWithOwner,
  createProject,
  createAnnouncement,
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

describe('Announcement API Contract Tests', () => {
  let app: any;
  let testUser: any;
  let testWorkspace: any;
  let testProject: any;

  const AnnouncementSchema = z.object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    visibility: z.string(),
    isPinned: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    workspaceSlug: z.string(),
    createdById: z.string(),
  });

  beforeAll(async () => {
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

  describe('Workspace Announcements', () => {
    it('GET /workspaces/:workspaceSlug/announcements should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspace.slug}/announcements`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(AnnouncementSchema, response.body.data[0]);
      }
    });

    it('POST /workspaces/:workspaceSlug/announcements should return success', async () => {
      const response = await request(app)
        .post(`/api/v1/workspaces/${testWorkspace.slug}/announcements`)
        .send({
          title: 'Workspace Announcement',
          content: 'Welcome to the workspace!',
          visibility: 'PUBLIC',
        });

      expect(response.status).toBe(201); // createAnnouncement in controller returns 201
      validateContract(APIResponseSchema, response.body);
    });
  });

  describe('Project Announcements', () => {
    it('GET /workspaces/:workspaceSlug/projects/:projectId/announcements should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspace.slug}/projects/${testProject.id}/announcements`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(AnnouncementSchema, response.body.data[0]);
      }
    });
  });

  describe('General Announcements', () => {
    it('GET /announcements/:id should match the contract', async () => {
      const announcement = await createAnnouncement(testWorkspace.slug, testUser.id, {
        title: 'General Announcement',
        content: 'Hello world',
      });

      const response = await request(app)
        .get(`/api/v1/announcements/${announcement.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(AnnouncementSchema, response.body.data);
    });

    it('DELETE /announcements/:id should return success', async () => {
      const announcement = await createAnnouncement(testWorkspace.slug, testUser.id, {
        title: 'General Announcement',
        content: 'Hello world',
      });

      const response = await request(app)
        .delete(`/api/v1/announcements/${announcement.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('PATCH /announcements/:id/pin should return success', async () => {
      const announcement = await createAnnouncement(testWorkspace.slug, testUser.id, {
        title: 'General Announcement',
        content: 'Hello world',
      });

      const response = await request(app)
        .patch(`/api/v1/announcements/${announcement.id}/pin`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
