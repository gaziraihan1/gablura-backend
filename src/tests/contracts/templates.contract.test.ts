import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-admin-id',
      email: 'admin@example.com',
      role: 'SUPER_ADMIN',
      name: 'Admin User',
      sessionId: 'admin-session-id',
    };
    next();
  },
}));

vi.mock('../../middleware/focuraAdmin.js', () => ({
  requireGabluraAdmin: (req: any, res: any, next: any) => next(),
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Templates API Contract Tests', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  describe('Public Routes', () => {
    it('POST /templates should return success on valid email', async () => {
      const email = `template-test-${Date.now()}@example.com`;
      const response = await request(app)
        .post('/api/v1/templates')
        .send({ email });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });

  describe('Admin Routes', () => {
    it('GET /templates should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/templates');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('DELETE /templates/:email should return success', async () => {
      const email = `delete-template-${Date.now()}@example.com`;
      await prisma.templateList.create({
        data: { email },
      });

      const response = await request(app)
        .delete(`/api/v1/templates/${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });
  });
});

describe('Template Rating Contract', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  it('GET /templates/admin/pending should match the contract', async () => {
    const response = await request(app).get('/api/v1/templates/admin/pending');

    expect(response.status).toBe(200);
    validateContract(APIResponseSchema, response.body);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('POST /templates/admin/:slug/approve should match the contract', async () => {
    const slug = 'moder-approve-' + Date.now();
    await prisma.projectTemplate.create({
      data: {
        slug,
        title: 'Moderation Approve',
        description: '',
        category: 'operations',
        complexity: 'starter',
        tier: 'FREE',
        status: 'available',
        visibility: 'PENDING',
        content: {} as object,
      },
    });

    const response = await request(app)
      .post('/api/v1/templates/admin/' + slug + '/approve');

    expect(response.status).toBe(200);
    validateContract(APIResponseSchema, response.body);
    expect(response.body.data.visibility).toBe('PUBLIC');
  });

  it('POST /templates/admin/:slug/reject should match the contract', async () => {
    const slug = 'moder-reject-' + Date.now();
    await prisma.projectTemplate.create({
      data: {
        slug,
        title: 'Moderation Reject',
        description: '',
        category: 'operations',
        complexity: 'starter',
        tier: 'FREE',
        status: 'available',
        visibility: 'PENDING',
        content: {} as object,
      },
    });

    const response = await request(app)
      .post('/api/v1/templates/admin/' + slug + '/reject');

    expect(response.status).toBe(200);
    validateContract(APIResponseSchema, response.body);
    expect(response.body.data.visibility).toBe('PRIVATE');
  });

  it('POST /templates/:slug/rate should match the contract', async () => {
    const slug = `rate-contract-${Date.now()}`;
    await prisma.projectTemplate.create({
      data: {
        slug,
        title: 'Contract Rate',
        description: '',
        category: 'operations',
        complexity: 'starter',
        tier: 'FREE',
        status: 'available',
        visibility: 'PUBLIC',
        content: {} as object,
      },
    });

    const response = await request(app)
      .post(`/api/v1/templates/${slug}/rate`)
      .send({ stars: 4 });

    expect(response.status).toBe(200);
    validateContract(APIResponseSchema, response.body);
    expect(typeof response.body.data.average).toBe('number');
    expect(typeof response.body.data.count).toBe('number');
  });
});
