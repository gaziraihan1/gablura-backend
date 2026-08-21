import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app from '../../../app.js';

// Mock the payment provider registry — accept any signature since we're testing the simulator, not verification
const mockHandler = {
  verifyAndParseWebhook: vi.fn().mockResolvedValue(null),
};
vi.mock('../../../payment/provider.registry.js', () => ({
  getPaymentProvider: vi.fn(() => mockHandler),
}));

// Mock prisma to avoid real DB calls
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    billingEvent: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'be_1', processed: false }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Mock rate limiter (pass-through in tests)
vi.mock('../../../middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: () => (req: any, res: any, next: any) => next(),
}));

// Mock billing webhook retry queue (no-op in tests)
vi.mock('../../../queue/index.js', () => ({
  addBillingWebhookRetryJob: vi.fn().mockResolvedValue(null),
}));

describe('🧪 Lemon Squeezy Webhook Simulator (dev)', () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'development';
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'ls_dev_webhook_secret_for_testing_only';

    // Default: handler returns null (event ignored)
    mockHandler.verifyAndParseWebhook.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  // ── GET /dev/webhooks/lemonsqueezy/events ──────────────────────────────

  describe('GET /dev/webhooks/lemonsqueezy/events', () => {
    it('should return list of supported events', async () => {
      const res = await request(app)
        .get('/dev/webhooks/lemonsqueezy/events')
        .expect(200);

      expect(res.body.events).toBeDefined();
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBe(12);
      expect(res.body.events[0]).toHaveProperty('name', 'subscription_created');
      expect(res.body.events[0]).toHaveProperty('mapsTo', 'SUBSCRIPTION_CREATED');
      expect(res.body.usage).toBeDefined();
      expect(res.body.usage.example).toContain('curl');
    });

    it('should return 404 in production', async () => {
      process.env.NODE_ENV = 'production';

      await request(app)
        .get('/dev/webhooks/lemonsqueezy/events')
        .expect(404);
    });
  });

  // ── POST /dev/webhooks/lemonsqueezy/simulate ──────────────────────────

  describe('POST /dev/webhooks/lemonsqueezy/simulate', () => {
    it('should return 400 when eventName is missing', async () => {
      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({})
        .expect(400);

      expect(res.body.error).toBe('Missing eventName');
      expect(res.body.supportedEvents).toContain('subscription_created');
    });

    it('should return 404 in production', async () => {
      process.env.NODE_ENV = 'production';

      await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({ eventName: 'subscription_created' })
        .expect(404);
    });

    it('should simulate subscription_created and forward to handler', async () => {
      // Handler returns null → event is "ignored" (already processed or unknown)
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'subscription_created',
          workspaceId: 'ws_test_123',
          planName: 'PRO',
          billingCycle: 'MONTHLY',
          status: 'active',
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.eventName).toBe('subscription_created');
      expect(res.body.event.workspaceId).toBe('ws_test_123');
      expect(res.body.event.planName).toBe('PRO');
      expect(res.body.webhook.signature).toMatch(/^[a-f0-9]{64}$/);
      expect(res.body.webhook.payloadPreview.meta.event_name).toBe('subscription_created');

      // Verify the handler was called with correct signature
      expect(mockHandler.verifyAndParseWebhook).toHaveBeenCalledTimes(1);
      const [body, headers] = mockHandler.verifyAndParseWebhook.mock.calls[0];
      expect(Buffer.isBuffer(body)).toBe(true);
      expect(headers['x-signature']).toMatch(/^[a-f0-9]{64}$/);

      // Verify payload contains custom_data
      const payload = JSON.parse(body.toString('utf-8'));
      expect(payload.meta.custom_data.workspaceId).toBe('ws_test_123');
      expect(payload.meta.custom_data.planName).toBe('PRO');
      expect(payload.meta.custom_data.billingCycle).toBe('MONTHLY');
    });

    it('should simulate subscription_cancelled', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'subscription_cancelled',
          workspaceId: 'ws_test_456',
          planName: 'BUSINESS',
          cancelled: true,
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.event.eventName).toBe('subscription_cancelled');

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.data.attributes.status).toBe('cancelled');
      expect(payload.data.attributes.cancelled).toBe(true);
    });

    it('should simulate order_created with custom total', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'order_created',
          workspaceId: 'ws_test_789',
          total: 1999,
          planName: 'BUSINESS',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.meta.event_name).toBe('order_created');
      expect(payload.data.attributes.total).toBe(1999);
    });

    it('should simulate order_refunded', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'order_refunded',
          workspaceId: 'ws_test_refund',
          total: 999,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.data.attributes.refund_total).toBe(999);
    });

    it('should handle webhook handler errors gracefully', async () => {
      mockHandler.verifyAndParseWebhook.mockRejectedValue(
        new Error('Invalid webhook signature'),
      );

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({ eventName: 'subscription_created' })
        .expect(400);

      expect(res.body.success).toBe(false);
    });

    it('should use default values when optional fields are omitted', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({ eventName: 'subscription_created' })
        .expect(200);

      expect(res.body.event.workspaceId).toBe('dev_workspace_001');
      expect(res.body.event.planName).toBe('PRO');

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.meta.custom_data.workspaceId).toBe('dev_workspace_001');
      expect(payload.meta.custom_data.planName).toBe('PRO');
      expect(payload.data.attributes.test_mode).toBe(true);
    });

    it('should support custom data passthrough', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'subscription_payment_success',
          customData: { customField: 'customValue', anotherField: '123' },
        })
        .expect(200);

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.meta.custom_data.customField).toBe('customValue');
      expect(payload.meta.custom_data.anotherField).toBe('123');
    });

    it('should simulate subscription_payment_failed', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'subscription_payment_failed',
          workspaceId: 'ws_test_fail',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.meta.event_name).toBe('subscription_payment_failed');
    });

    it('should simulate subscription_paused', async () => {
      mockHandler.verifyAndParseWebhook.mockResolvedValue(null);

      const res = await request(app)
        .post('/dev/webhooks/lemonsqueezy/simulate')
        .send({
          eventName: 'subscription_paused',
          workspaceId: 'ws_test_paused',
          status: 'paused',
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const payload = JSON.parse(
        mockHandler.verifyAndParseWebhook.mock.calls[0][0].toString('utf-8'),
      );
      expect(payload.data.attributes.status).toBe('paused');
    });
  });
});
