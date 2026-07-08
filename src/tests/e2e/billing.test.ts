import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner, createAdminUser } from '../factories/index.js';
import { authWithCsrfHeaders } from '../helpers/auth.js';

// Mock the billing service to avoid actual Stripe/Paddle calls
vi.mock('../../modules/billing/billing.service.js', () => ({
  BillingService: {
    createCheckoutSession: vi.fn().mockResolvedValue('https://checkout.stripe.com/test-session'),
    createPortalSession: vi.fn().mockResolvedValue('https://billing.stripe.com/test-portal'),
    getWorkspaceSubscription: vi.fn().mockResolvedValue({
      workspaceId: 'test-workspace-id',
      planName: 'PRO',
      status: 'ACTIVE',
    }),
    changePlan: vi.fn().mockResolvedValue({ planName: 'BUSINESS', status: 'ACTIVE' }),
    cancelSubscription: vi.fn().mockResolvedValue({ cancelled: true }),
    reactivateSubscription: vi.fn().mockResolvedValue({ reactivated: true }),
    getInvoices: vi.fn().mockImplementation((workspaceId, userId, limit) => {
      const invoices = [
        { id: 'inv_1', amount: 2900, status: 'PAID', date: '2024-01-15' },
        { id: 'inv_2', amount: 2900, status: 'PAID', date: '2024-02-15' },
      ];
      return Promise.resolve(invoices.slice(0, limit));
    }),
  },
}));

describe('💳 Billing & Subscription Journeys', () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
  });

  it('should complete the "Subscription Checkout" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a checkout session for PRO plan
     * 2. User receives checkout URL
     * 3. User creates a checkout session for BUSINESS plan
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-checkout-${Date.now()}`,
    });

    // 1. Create checkout session for PRO plan
    const checkoutRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-checkout-session`)
      .set(headers)
      .send({
        planName: 'PRO',
        billingCycle: 'MONTHLY',
      });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
    expect(checkoutRes.body.data.url).toContain('checkout.stripe.com');

    // 2. Create checkout session for BUSINESS plan
    const businessCheckoutRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-checkout-session`)
      .set(headers)
      .send({
        planName: 'BUSINESS',
        billingCycle: 'YEARLY',
      });

    expect(businessCheckoutRes.status).toBe(200);
    expect(businessCheckoutRes.body.success).toBe(true);
    expect(businessCheckoutRes.body.data.url).toContain('checkout.stripe.com');
  });

  it('should complete the "Customer Portal" journey', async () => {
    /**
     * JOURNEY:
     * 1. User creates a portal session
     * 2. User receives portal URL
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-portal-${Date.now()}`,
    });

    const portalRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-portal-session`)
      .set(headers);

    expect(portalRes.status).toBe(200);
    expect(portalRes.body.success).toBe(true);
    expect(portalRes.body.data.url).toContain('billing.stripe.com');
  });

  it('should complete the "Plan Change" journey', async () => {
    /**
     * JOURNEY:
     * 1. User changes plan from FREE to PRO
     * 2. User changes plan from PRO to BUSINESS
     * 3. User changes plan back to FREE
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-change-${Date.now()}`,
    });

    // 1. Change to PRO
    const changeToProRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/change-plan`)
      .set(headers)
      .send({
        newPlanName: 'PRO',
        billingCycle: 'MONTHLY',
      });

    expect(changeToProRes.status).toBe(200);
    expect(changeToProRes.body.success).toBe(true);

    // 2. Change to BUSINESS
    const changeToBusinessRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/change-plan`)
      .set(headers)
      .send({
        newPlanName: 'BUSINESS',
        billingCycle: 'YEARLY',
      });

    expect(changeToBusinessRes.status).toBe(200);
    expect(changeToBusinessRes.body.success).toBe(true);

    // 3. Change back to FREE
    const changeToFreeRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/change-plan`)
      .set(headers)
      .send({
        newPlanName: 'FREE',
      });

    expect(changeToFreeRes.status).toBe(200);
    expect(changeToFreeRes.body.success).toBe(true);
  });

  it('should complete the "Subscription Cancellation" journey', async () => {
    /**
     * JOURNEY:
     * 1. User cancels subscription at end of period
     * 2. User immediately cancels subscription
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-cancel-${Date.now()}`,
    });

    // 1. Cancel at end of period
    const cancelEndRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/cancel-subscription`)
      .set(headers)
      .send({
        immediately: false,
        reason: 'No longer needed',
      });

    expect(cancelEndRes.status).toBe(200);
    expect(cancelEndRes.body.success).toBe(true);
    expect(cancelEndRes.body.data.cancelled).toBe(true);

    // 2. Immediate cancellation
    const cancelImmediateRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/cancel-subscription`)
      .set(headers)
      .send({
        immediately: true,
        reason: 'Immediate cancellation',
      });

    expect(cancelImmediateRes.status).toBe(200);
    expect(cancelImmediateRes.body.success).toBe(true);
  });

  it('should complete the "Subscription Reactivation" journey', async () => {
    /**
     * JOURNEY:
     * 1. User reactivates a cancelled subscription
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-reactivate-${Date.now()}`,
    });

    const reactivateRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/reactivate-subscription`)
      .set(headers);

    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.success).toBe(true);
    expect(reactivateRes.body.data.reactivated).toBe(true);
  });

  it('should complete the "Invoice Retrieval" journey', async () => {
    /**
     * JOURNEY:
     * 1. User retrieves invoice history
     * 2. User retrieves limited number of invoices
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-invoices-${Date.now()}`,
    });

    // 1. Get all invoices
    const invoicesRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices`)
      .set(headers);

    expect(invoicesRes.status).toBe(200);
    expect(invoicesRes.body.success).toBe(true);
    expect(Array.isArray(invoicesRes.body.data)).toBe(true);
    expect(invoicesRes.body.data.length).toBeGreaterThanOrEqual(2);

    // 2. Get limited invoices
    const limitedRes = await request(app)
      .get(`/api/v1/workspaces/${testWorkspace.id}/billing/invoices`)
      .set(headers)
      .query({ limit: 1 });

    expect(limitedRes.status).toBe(200);
    expect(limitedRes.body.success).toBe(true);
    expect(limitedRes.body.data.length).toBeLessThanOrEqual(1);
  });

  it('should handle invalid plan names', async () => {
    /**
     * JOURNEY:
     * 1. User attempts to create checkout with invalid plan
     * 2. User attempts to change to invalid plan
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-invalid-${Date.now()}`,
    });

    // 1. Invalid checkout plan
    const invalidCheckoutRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-checkout-session`)
      .set(headers)
      .send({
        planName: 'INVALID_PLAN',
      });

    expect(invalidCheckoutRes.status).toBe(400);

    // 2. Invalid change plan
    const invalidChangeRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/change-plan`)
      .set(headers)
      .send({
        newPlanName: 'INVALID_PLAN',
      });

    expect(invalidChangeRes.status).toBe(400);
  });

  it('should handle billing cycle variations', async () => {
    /**
     * JOURNEY:
     * 1. User tests MONTHLY billing cycle
     * 2. User tests YEARLY billing cycle
     */
    const headers = await authWithCsrfHeaders(testUser, {
      sessionId: `session-billing-cycle-${Date.now()}`,
    });

    // 1. MONTHLY cycle
    const monthlyRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-checkout-session`)
      .set(headers)
      .send({
        planName: 'PRO',
        billingCycle: 'MONTHLY',
      });

    expect(monthlyRes.status).toBe(200);

    // 2. YEARLY cycle
    const yearlyRes = await request(app)
      .post(`/api/v1/workspaces/${testWorkspace.id}/billing/create-checkout-session`)
      .set(headers)
      .send({
        planName: 'PRO',
        billingCycle: 'YEARLY',
      });

    expect(yearlyRes.status).toBe(200);
  });
});
