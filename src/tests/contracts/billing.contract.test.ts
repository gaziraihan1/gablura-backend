import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { z } from 'zod';
import { validateContract, APIResponseSchema } from './contract.util.js';
import { prisma } from '../../lib/prisma.js';
import { createWorkspaceWithOwner } from '../factories/index.js';

// Mocking the payment provider to avoid real Stripe calls and 500 errors
vi.mock('../../payment/provider.registry.js', () => ({
  getPaymentProvider: () => ({
    createCustomer: async () => ({ providerCustomerId: 'cus_test_123' }),
    createCheckoutSession: async () => ({ url: 'https://checkout.stripe.com/test' }),
    createPortalSession: async () => ({ url: 'https://billing.stripe.com/test' }),
    changePlan: async () => {},
    cancelSubscription: async () => {},
    reactivateSubscription: async () => {},
  }),
}));

vi.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if ((global as any).testUser) {
      req.user = (global as any).testUser;
    }
    next();
  },
}));

vi.mock('../../middleware/csrf.js', () => ({
  requireCsrfToken: () => (req: any, res: any, next: any) => next(),
  getCsrfTokenHandler: (req: any, res: any) => res.json({ success: true, data: { csrfToken: 'mock-token' } }),
}));

describe('Billing API Contract Tests', () => {
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

  const SubscriptionSchema = z.object({
    status: z.string(),
    billingCycle: z.string(),
    currentPeriodEnd: z.string(),
    cancelAtPeriodEnd: z.boolean(),
    planName: z.string(),
    monthlyPriceCents: z.number().optional(),
  });

  describe('Subscription Operations', () => {
    it('GET /workspaces/:workspaceId/billing/subscription should match the contract', async () => {
      const plan = await prisma.plan.findFirst({ where: { name: 'PRO' } });
      await prisma.subscription.create({
        data: {
          workspaceId: testWorkspace.id,
          planId: plan?.id ?? (await prisma.plan.create({ data: { name: 'PRO', displayName: 'Pro Plan', stripePriceIdMonthly: 'price_pro_monthly', stripePriceIdYearly: 'price_pro_yearly' } })).id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          stripeSubscriptionId: 'sub_test_123',
          stripeCustomerId: 'cus_test_123',
          stripePriceId: 'price_test_123',
        },
      });

      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/subscription`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      if (response.body.data) {
        validateContract(SubscriptionSchema, response.body.data);
      }
    });

    it('POST /workspaces/:workspaceId/billing/create-checkout-session should return success', async () => {
      const response = await request(app)
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-checkout-session`)
        .send({ planName: 'PRO' });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /workspaces/:workspaceId/billing/create-portal-session should return success', async () => {
      await prisma.user.update({
        where: { id: testUser.id },
        data: { stripeCustomerId: 'cus_test_123' },
      });

      const response = await request(app)
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-portal-session`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /workspaces/:workspaceId/billing/change-plan should return success', async () => {
      const plan = await prisma.plan.findFirst({ where: { name: 'PRO' } });
      await prisma.subscription.create({
        data: {
          workspaceId: testWorkspace.id,
          planId: plan?.id ?? (await prisma.plan.create({ data: { name: 'PRO', displayName: 'Pro Plan', stripePriceIdMonthly: 'price_pro_monthly', stripePriceIdYearly: 'price_pro_yearly' } })).id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          stripeSubscriptionId: 'sub_test_123',
          stripeCustomerId: 'cus_test_123',
          stripePriceId: 'price_test_123',
        },
      });

      const response = await request(app)
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/change-plan`)
        .send({ newPlanName: 'BUSINESS' });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /workspaces/:workspaceId/billing/cancel-subscription should return success', async () => {
      const plan = await prisma.plan.findFirst({ where: { name: 'PRO' } });
      await prisma.subscription.create({
        data: {
          workspaceId: testWorkspace.id,
          planId: plan?.id ?? (await prisma.plan.create({ data: { name: 'PRO', displayName: 'Pro Plan', stripePriceIdMonthly: 'price_pro_monthly', stripePriceIdYearly: 'price_pro_yearly' } })).id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          stripeSubscriptionId: 'sub_test_123',
          stripeCustomerId: 'cus_test_123',
          stripePriceId: 'price_test_123',
        },
      });

      const response = await request(app)
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/cancel-subscription`)
        .send({ immediately: false });

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('POST /workspaces/:workspaceId/billing/reactivate-subscription should return success', async () => {
      const plan = await prisma.plan.findFirst({ where: { name: 'PRO' } });
      await prisma.subscription.create({
        data: {
          workspaceId: testWorkspace.id,
          planId: plan?.id ?? (await prisma.plan.create({ data: { name: 'PRO', displayName: 'Pro Plan', stripePriceIdMonthly: 'price_pro_monthly', stripePriceIdYearly: 'price_pro_yearly' } })).id,
          status: 'ACTIVE',
          billingCycle: 'MONTHLY',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          stripeSubscriptionId: 'sub_test_123',
          cancelAtPeriodEnd: true,
          stripeCustomerId: 'cus_test_123',
          stripePriceId: 'price_test_123',
        },
      });

      const response = await request(app)
        .post(`/api/v1/workspaces/${testWorkspace.id}/billing/reactivate-subscription`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
    });

    it('GET /workspaces/:workspaceId/billing/invoices should match the contract', async () => {
      const response = await request(app)
        .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices`);

      expect(response.status).toBe(200);
      validateContract(APIResponseSchema, response.body);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});
