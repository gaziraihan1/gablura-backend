import { describe, it, expect, beforeAll, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if ((global as any).testUser) {
      req.user = (global as any).testUser;
    } else {
      req.user = {
        id: 'test-admin-id',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
        name: 'Admin User',
        sessionId: 'admin-session-id',
      };
    }
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

describe('Resource API Contract Tests', () => {
  let app: any;
  let testAdmin: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  beforeEach(async () => {
    testAdmin = await prisma.user.upsert({
      where: { email: 'admin@example.com' },
      update: { email: 'admin@example.com' },
      create: {
        email: 'admin@example.com',
        name: 'Admin User',
        password: 'password',
        role: 'SUPER_ADMIN',
      },
    });
    (global as any).testUser = testAdmin;
  });

  const ResourceSchema = z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    image: z.string(),
    category: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

  describe('Public Routes', () => {
    it('GET /resources/popular should match the contract', async () => {
      await prisma.popularResource.create({
        data: {
          title: 'List Popular Resource',
          description: 'Desc',
          image: 'http://image.com',
          category: 'Category',
          slug: 'list-popular',
          status: 'PUBLIC',
          createdById: testAdmin.id,
        },
      });

      const response = await request(app)
        .get('/api/v1/resources/popular');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data.items)).toBe(true);
      if (response.body.data.items.length > 0) {
        validateContract(ResourceSchema, response.body.data.items[0]);
      }
    });

    it('GET /resources/popular/:slug should match the contract', async () => {
      const resource = await prisma.popularResource.create({
        data: {
          title: 'Popular Guide',
          description: 'Guide content',
          image: 'http://image.com',
          category: 'Guide',
          slug: 'popular-guide',
          status: 'PUBLIC',
          createdById: testAdmin.id,
        },
      });

      const response = await request(app)
        .get(`/api/v1/resources/popular/${resource.slug}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      validateContract(ResourceSchema, response.body.data);
    });

    it('GET /resources/product-updates should match the contract', async () => {
      await prisma.productUpdate.create({
        data: {
          title: 'List Product Update',
          date: new Date(),
          description: 'Desc',
          version: '1.0.0',
          status: 'PUBLIC',
          createdById: testAdmin.id,
          slug: 'list-update',
        },
      });

      const response = await request(app)
        .get('/api/v1/resources/product-updates');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data.items)).toBe(true);
    });

    it('GET /resources/product-updates/:slug should match the contract', async () => {
      const update = await prisma.productUpdate.create({
        data: {
          title: 'Update v1',
          date: new Date(),
          description: 'Update content',
          version: '1.0.0',
          status: 'PUBLIC',
          createdById: testAdmin.id,
          slug: 'update-v1',
        },
      });

      const response = await request(app)
        .get(`/api/v1/resources/product-updates/${update.slug}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });

  describe('Admin Routes', () => {
    it('GET /admin/resources/popular should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/admin/resources/popular');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /admin/resources/popular should return success', async () => {
      const response = await request(app)
        .post('/api/v1/admin/resources/popular')
        .send({
          title: 'Admin Resource',
          description: 'Desc',
          image: 'http://image.com',
          category: 'Category',
          slug: 'admin-resource',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
    });

    it('PATCH /admin/resources/popular/:slug should return success', async () => {
      const resource = await prisma.popularResource.create({
        data: {
          title: 'Patch Resource',
          description: 'Desc',
          image: 'http://image.com',
          category: 'Category',
          slug: 'patch-resource',
          createdById: testAdmin.id,
        },
      });

      const response = await request(app)
        .patch(`/api/v1/admin/resources/popular/${resource.slug}`)
        .send({
          title: 'Updated Title',
        });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('DELETE /admin/resources/popular/:slug should return success', async () => {
      const resource = await prisma.popularResource.create({
        data: {
          title: 'Delete Resource',
          description: 'Desc',
          image: 'http://image.com',
          category: 'Category',
          slug: 'delete-resource',
          createdById: testAdmin.id,
        },
      });

      const response = await request(app)
        .delete(`/api/v1/admin/resources/popular/${resource.slug}`);

      expect(response.status).toBe(204);
    });
  });
});
