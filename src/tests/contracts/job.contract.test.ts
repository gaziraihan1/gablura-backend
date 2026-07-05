import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import {
  createAdminUser,
  createJobPosting,
} from '../factories/index.js';

// Shared state for the mock authentication
const mockUser = {
  id: 'pending',
  email: 'pending@example.com',
  role: 'SUPER_ADMIN',
  name: 'Pending Admin',
  sessionId: 'admin-session-id',
};

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = mockUser;
    next();
  },
}));

vi.mock('../../middleware/focuraAdmin.js', () => ({
  requireFocuraAdmin: (req: any, res: any, next: any) => next(),
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Job API Contract Tests', () => {
  let app: any;
  let testAdmin: any;

  const JobSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    slug: z.string(),
    location: z.string(),
    type: z.string(),
    salaryMin: z.number().nullable(),
    salaryMax: z.number().nullable(),
    salaryCurrency: z.string(),
    isPinned: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    // Create a fresh admin user for each test to avoid truncation issues
    testAdmin = await createAdminUser({
      email: 'admin@example.com',
      name: 'Admin User',
    });

    // Update the shared mock user
    Object.assign(mockUser, {
      id: testAdmin.id,
      email: testAdmin.email,
      role: testAdmin.role,
      name: testAdmin.name,
    });
  });

  describe('Public Routes', () => {
    it('GET /jobs should match the contract', async () => {
      // Ensure at least one job exists and is OPEN
      await createJobPosting(testAdmin.id, {
        status: 'OPEN' as any,
      });

      const response = await request(app)
        .get('/api/v1/jobs');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(JobSchema, response.body.data[0]);
      }
    });

    it('GET /jobs/:slug should match the contract', async () => {
      const job = await createJobPosting(testAdmin.id, {
        title: 'Software Engineer',
        description: 'Great role with amazing opportunities to grow and learn in a fast-paced environment!',
        status: 'OPEN' as any,
      });

      const response = await request(app)
        .get(`/api/v1/jobs/${job.slug}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(JobSchema, response.body.data);
    });
  });

  describe('Admin Routes', () => {
    it('GET /jobs/admin/all should match the contract', async () => {
      await createJobPosting(testAdmin.id, {
        status: 'OPEN' as any,
      });

      const response = await request(app)
        .get('/api/v1/jobs/admin/all');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(JobSchema, response.body.data[0]);
      }
    });

    it('POST /jobs/admin should return success on creation', async () => {
      const response = await request(app)
        .post('/api/v1/jobs/admin')
        .send({
          title: 'New Job',
          description: 'This is a detailed description that exceeds the fifty character minimum requirement.',
          location: 'Remote',
          type: 'FULL_TIME',
          department: 'ENGINEERING',
          requirements: 'This is a detailed list of requirements that exceeds twenty characters.',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
    });

    it('PUT /jobs/admin/:id should return success on update', async () => {
      const job = await createJobPosting(testAdmin.id, {
        title: 'Old Job',
        description: 'This is a detailed description that exceeds the fifty character minimum requirement.',
      });

      const response = await request(app)
        .put(`/api/v1/jobs/admin/${job.id}`)
        .send({
          title: 'Updated Job',
        });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /jobs/admin/:id should return success', async () => {
      const job = await createJobPosting(testAdmin.id, {
        title: 'Job to delete',
        description: 'This is a detailed description that exceeds the fifty character minimum requirement.',
      });

      const response = await request(app)
        .delete(`/api/v1/jobs/admin/${job.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('PATCH /jobs/admin/:id/pin should return success', async () => {
      const job = await createJobPosting(testAdmin.id, {
        title: 'Pinned Job',
        description: 'This is a detailed description that exceeds the fifty character minimum requirement.',
      });

      const response = await request(app)
        .patch(`/api/v1/jobs/admin/${job.id}/pin`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});
