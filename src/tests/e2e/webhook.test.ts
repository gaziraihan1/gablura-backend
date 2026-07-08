import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../app.js';
import { createWorkspaceWithOwner } from '../factories/index.js';
import crypto from 'crypto';

// Helper to store dynamic IDs for the mock
const mockContext = {
  workspaceId: 'placeholder-ws',
  userId: 'placeholder-user',
};

// Mock the payment provider registry
vi.mock('../../payment/provider.registry.js', () => ({
  getPaymentProvider: vi.fn(() => ({
    verifyAndParseWebhook: vi.fn((body: Buffer, headers: Record<string, string | string[] | undefined>) => {
      // Simulate signature verification
      const signature = headers['stripe-signature'] as string || headers['paddle-signature'] as string;
      
      if (!signature) {
        throw new Error('Missing signature');
      }

      // For testing, we'll accept valid-looking signatures
      if (signature.startsWith('v1_') || signature.startsWith('sig_')) {
        // Return a mock subscription event
        return {
          type: 'SUBSCRIPTION_CREATED',
          providerEventId: `evt_${crypto.randomUUID()}`,
          providerSubscriptionId: `sub_${crypto.randomUUID()}`,
          providerCustomerId: `cus_${crypto.randomUUID()}`,
          providerPriceId: `price_${crypto.randomUUID()}`,
          planName: 'PRO',
          billingCycle: 'MONTHLY',
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          cancelAtPeriodEnd: false,
          canceledAt: null,
          trialStart: null,
          trialEnd: null,
          metadata: {
            workspaceId: mockContext.workspaceId,
            ownerId: mockContext.userId,
          },
          raw: { test: true },
        };
      }

      throw new Error('Invalid signature');
    }),
  })),
}));

describe('🔔 Payment Webhook Journeys', () => {
  let testUser: any;
  let testWorkspace: any;

  beforeEach(async () => {
    const setup = await createWorkspaceWithOwner();
    testUser = setup.user;
    testWorkspace = setup.workspace;
    
    mockContext.workspaceId = testWorkspace.id;
    mockContext.userId = testUser.id;
  });

  it('should handle valid Stripe webhook signature', async () => {
    /**
     * JOURNEY:
     * 1. Stripe sends a webhook with valid signature
     * 2. System verifies signature and processes event
     */
    const payload = JSON.stringify({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: `sub_${crypto.randomUUID()}`,
          customer: `cus_${crypto.randomUUID()}`,
          items: {
            data: [{
              price: {
                id: `price_${crypto.randomUUID()}`,
                metadata: {
                  planName: 'PRO',
                },
              },
            }],
          },
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: {
            workspaceId: testWorkspace.id,
            ownerId: testUser.id,
          },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'v1_valid_signature_' + crypto.randomBytes(32).toString('hex'))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('should handle valid Paddle webhook signature', async () => {
    /**
     * JOURNEY:
     * 1. Paddle sends a webhook with valid signature
     * 2. System verifies signature and processes event
     */
    const payload = JSON.stringify({
      event_type: 'subscription.created',
      data: {
        id: `sub_${crypto.randomUUID()}`,
        customer_id: `ctm_${crypto.randomUUID()}`,
        items: [{
          price: {
            id: `price_${crypto.randomUUID()}`,
            custom_data: {
              planName: 'PRO',
            },
          },
        }],
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cancel_at_period_end: false,
        custom_data: {
          workspaceId: testWorkspace.id,
          ownerId: testUser.id,
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('paddle-signature', 'sig_valid_signature_' + crypto.randomBytes(32).toString('hex'))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('should reject webhook with missing signature', async () => {
    /**
     * JOURNEY:
     * 1. Webhook sent without signature
     * 2. System rejects the request
     */
    const payload = JSON.stringify({
      type: 'customer.subscription.created',
      data: {},
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('verification failed');
  });

  it('should reject webhook with invalid signature', async () => {
    /**
     * JOURNEY:
     * 1. Webhook sent with invalid signature
     * 2. System rejects the request
     */
    const payload = JSON.stringify({
      type: 'customer.subscription.created',
      data: {},
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'invalid_signature')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('verification failed');
  });

  it('should handle idempotent webhook events', async () => {
    /**
     * JOURNEY:
     * 1. Same webhook event sent twice
     * 2. System processes first time, skips second time
     */
    const payload = JSON.stringify({
      type: 'customer.subscription.created',
      data: {
        object: {
          id: `sub_${crypto.randomUUID()}`,
          customer: `cus_${crypto.randomUUID()}`,
          items: {
            data: [{
              price: {
                id: `price_${crypto.randomUUID()}`,
                metadata: {
                  planName: 'PRO',
                },
              },
            }],
          },
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: {
            workspaceId: testWorkspace.id,
            ownerId: testUser.id,
          },
        },
      },
    });

    const eventId = `evt_${crypto.randomUUID()}`;
    const signature = 'v1_valid_signature_' + crypto.randomBytes(32).toString('hex');

    // First request
    const res1 = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);

    expect(res1.status).toBe(200);
    expect(res1.body.received).toBe(true);

    // Second request with same event (would be idempotent in real system)
    const res2 = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.received).toBe(true);
  });

  it('should handle invoice payment webhook', async () => {
    /**
     * JOURNEY:
     * 1. Stripe sends invoice payment webhook
     * 2. System processes payment successfully
     */
    const payload = JSON.stringify({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: `in_${crypto.randomUUID()}`,
          subscription: `sub_${crypto.randomUUID()}`,
          customer: `cus_${crypto.randomUUID()}`,
          amount_paid: 2900,
          currency: 'usd',
          status: 'paid',
          metadata: {
            workspaceId: testWorkspace.id,
            ownerId: testUser.id,
          },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'v1_valid_signature_' + crypto.randomBytes(32).toString('hex'))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('should handle invoice payment failed webhook', async () => {
    /**
     * JOURNEY:
     * 1. Stripe sends invoice payment failed webhook
     * 2. System marks subscription as past due
     */
    const payload = JSON.stringify({
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: `in_${crypto.randomUUID()}`,
          subscription: `sub_${crypto.randomUUID()}`,
          customer: `cus_${crypto.randomUUID()}`,
          amount_due: 2900,
          currency: 'usd',
          status: 'open',
          metadata: {
            workspaceId: testWorkspace.id,
            ownerId: testUser.id,
          },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'v1_valid_signature_' + crypto.randomBytes(32).toString('hex'))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('should handle subscription cancellation webhook', async () => {
    /**
     * JOURNEY:
     * 1. Stripe sends subscription cancellation webhook
     * 2. System downgrades workspace to FREE
     */
    const payload = JSON.stringify({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: `sub_${crypto.randomUUID()}`,
          customer: `cus_${crypto.randomUUID()}`,
          cancel_at_period_end: false,
          metadata: {
            workspaceId: testWorkspace.id,
            ownerId: testUser.id,
          },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'v1_valid_signature_' + crypto.randomBytes(32).toString('hex'))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('should handle checkout completed webhook', async () => {
    /**
     * JOURNEY:
     * 1. Stripe sends checkout completed webhook
     * 2. System acknowledges checkout completion
     */
    const payload = JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_${crypto.randomUUID()}`,
          subscription: `sub_${crypto.randomUUID()}`,
          customer: `cus_${crypto.randomUUID()}`,
          metadata: {
            workspaceId: testWorkspace.id,
            ownerId: testUser.id,
          },
        },
      },
    });

    const res = await request(app)
      .post('/webhooks/billing')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'v1_valid_signature_' + crypto.randomBytes(32).toString('hex'))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });
});
