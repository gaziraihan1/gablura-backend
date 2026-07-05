import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

// Define state outside vi.mock so it's accessible to the tests
const mockAuth = {
  isAdmin: false,
};

const setMockAdmin = (val: boolean) => {
  mockAuth.isAdmin = val;
};

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      role: mockAuth.isAdmin ? 'ADMIN' : 'USER',
      name: 'Test User',
      sessionId: 'test-session-id',
    };
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Feature Request API Contract Tests', () => {
  let app: any;
  const testUserId = 'test-user-id';

  beforeAll(async () => {
    vi.stubEnv('FOCURA_ADMIN_IDS', testUserId);
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ensureUserExists = async () => {
    await prisma.user.upsert({
      where: { email: 'test-user@example.com' },
      update: { id: testUserId },
      create: {
        id: testUserId,
        email: 'test-user@example.com',
        name: 'Test User',
        password: 'password',
      },
    });
  };

  const FeatureRequestSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.string(),
    adminNote: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.object({
      id: z.string(),
      name: z.string(),
      image: z.string().nullable(),
    }),
    _count: z.object({
      upvotes: z.number(),
      downvotes: z.number(),
    }),
    userVote: z.string().nullable(),
  });

  describe('General Operations', () => {
    beforeEach(async () => {
      await ensureUserExists();
      setMockAdmin(false);
    });

    it('GET /features should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/features');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
      if (response.body.data.length > 0) {
        validateContract(FeatureRequestSchema, response.body.data[0]);
      }
    });

    it('POST /features should return success', async () => {
      const response = await request(app)
        .post('/api/v1/features')
        .send({
          title: 'New Feature',
          description: 'I want this feature',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
      validateContract(FeatureRequestSchema, response.body.data);
    });

    it('GET /features/:id should match the contract', async () => {
      const feature = await prisma.featureRequest.create({
        data: {
          title: 'Single Feature',
          description: 'Description',
          createdById: testUserId,
        },
      });

      const response = await request(app)
        .get(`/api/v1/features/${feature.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(FeatureRequestSchema, response.body.data);
    });

    it('PATCH /features/:id/status should return success', async () => {
      const feature = await prisma.featureRequest.create({
        data: {
          title: 'Status Feature',
          description: 'Desc',
          createdById: testUserId,
        },
      });

      process.env.FOCURA_ADMIN_IDS = testUserId;
      setMockAdmin(true);
      const response = await request(app)
        .patch(`/api/v1/features/${feature.id}/status`)
        .send({ status: 'APPROVED' });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(FeatureRequestSchema, response.body.data);
    });

    it('DELETE /features/:id should return success', async () => {
      const feature = await prisma.featureRequest.create({
        data: {
          title: 'Delete Feature',
          description: 'Desc',
          createdById: testUserId,
        },
      });

      process.env.FOCURA_ADMIN_IDS = testUserId;
      setMockAdmin(true);
      const response = await request(app)
        .delete(`/api/v1/features/${feature.id}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /features/:id/vote should return success', async () => {
      const feature = await prisma.featureRequest.create({
        data: {
          title: 'Vote Feature',
          description: 'Desc',
          createdById: testUserId,
        },
      });

      const response = await request(app)
        .post(`/api/v1/features/${feature.id}/vote`)
        .send({ type: 'UP' });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /features/:id/vote should return success', async () => {
      const feature = await prisma.featureRequest.create({
        data: {
          title: 'Vote Feature',
          description: 'Desc',
          createdById: testUserId,
        },
      });

      // Cast a vote first so there is something to delete
      await prisma.featureVote.create({
        data: { userId: testUserId, featureRequestId: feature.id, type: 'UP' },
      });

      const response = await request(app)
        .delete(`/api/v1/features/${feature.id}/vote`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /features/admin/me should match the contract', async () => {
      setMockAdmin(true);
      const response = await request(app)
        .get('/api/v1/features/admin/me');

      expect(response.status).toBe(200);
      validateContract(z.object({
        success: z.literal(true),
        isAdmin: z.boolean(),
      }), response.body);
    });
  });
});

