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

describe('Contact API Contract Tests', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../../app.js');
    app = appModule.default;
  });

  const ContactMessageSchema = z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    subject: z.string(),
    category: z.string(),
    status: z.string(),
    message: z.string(),
    createdAt: z.string(),
  });

  describe('Public Routes', () => {
    it('POST /contact should return success on valid submission', async () => {
      const response = await request(app)
        .post('/api/v1/contact')
        .send({
          email: 'customer@example.com',
          name: 'Customer',
          subject: 'Support Request',
          category: 'GENERAL',
          message: 'Hello, I need some help with my account settings. Please assist!',
        });

      expect(response.status).toBe(201);
      validateContract(APIResponseSchema, response.body);
    });
  });

  describe('Admin Routes', () => {
    it('GET /contact should match the contract', async () => {
      const response = await request(app)
        .get('/api/v1/contact');

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.messages)).toBe(true);
      if (response.body.messages.length > 0) {
        validateContract(ContactMessageSchema, response.body.messages[0]);
      }
    });
  });
});
