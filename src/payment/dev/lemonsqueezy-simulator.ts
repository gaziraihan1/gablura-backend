// backend/src/payment/dev/lemonsqueezy-simulator.ts
//
// Development-only endpoint that simulates Lemon Squeezy webhook events.
// Generates realistic webhook payloads, signs them with HMAC-SHA256,
// and forwards them to the real webhook handler.
//
// SECURITY: This endpoint is only registered when NODE_ENV !== 'production'.
// It requires no authentication for convenience during local development.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { createHmac, randomUUID } from 'crypto';
import { webhookHandler } from '../webhook.handler.js';
import { raw } from 'express';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SimulateWebhookBody {
  /** Lemon Squeezy event name (e.g. "subscription_created") */
  eventName: string;

  /** Workspace ID to inject as custom_data.workspaceId */
  workspaceId?: string;

  /** Owner ID to inject as custom_data.ownerId */
  ownerId?: string;

  /** Plan name (PRO | BUSINESS). Defaults to "PRO". */
  planName?: string;

  /** Billing cycle (MONTHLY | YEARLY). Defaults to "MONTHLY". */
  billingCycle?: string;

  /** Subscription ID. Auto-generated if omitted. */
  subscriptionId?: string;

  /** Customer ID. Auto-generated if omitted. */
  customerId?: string;

  /** Variant ID. Auto-generated based on planName/billingCycle if omitted. */
  variantId?: string;

  /** Subscription status override (active | on_trial | past_due | cancelled | paused). */
  status?: string;

  /** Order ID for order_* events. Auto-generated if omitted. */
  orderId?: string;

  /** Total amount in cents for order events. Defaults to 999. */
  total?: number;

  /** Whether the subscription is cancelled. Defaults to false. */
  cancelled?: boolean;

  /** Custom data to include beyond the defaults. */
  customData?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Variant ID fallbacks (for when no real variants are configured)
// ---------------------------------------------------------------------------

const FALLBACK_VARIANTS: Record<string, Record<string, string>> = {
  PRO: {
    MONTHLY: 'ls_var_pro_monthly_dev',
    YEARLY: 'ls_var_pro_yearly_dev',
  },
  BUSINESS: {
    MONTHLY: 'ls_var_biz_monthly_dev',
    YEARLY: 'ls_var_biz_yearly_dev',
  },
};

// ---------------------------------------------------------------------------
// Payload builders
// ---------------------------------------------------------------------------

function buildSubscriptionPayload(body: SimulateWebhookBody) {
  const subId = body.subscriptionId ?? `ls_dev_sub_${randomUUID().slice(0, 8)}`;
  const custId = body.customerId ?? `ls_dev_cust_${randomUUID().slice(0, 8)}`;
  const planName = body.planName ?? 'PRO';
  const cycle = body.billingCycle ?? 'MONTHLY';
  const variantId = body.variantId ?? FALLBACK_VARIANTS[planName]?.[cycle] ?? 'ls_var_dev';
  // Derive status from explicit fields: if status is given, use it;
  // otherwise, infer from the cancelled flag so callers don't have to set both.
  const cancelled = body.cancelled ?? (body.status === 'cancelled');
  const status = body.status ?? (cancelled ? 'cancelled' : 'active');
  const now = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  return {
    meta: {
      event_name: body.eventName,
      custom_data: {
        workspaceId: body.workspaceId ?? 'dev_workspace_001',
        ownerId: body.ownerId ?? 'dev_owner_001',
        planName,
        billingCycle: cycle,
        ...body.customData,
      },
    },
    data: {
      id: parseInt(subId.replace(/\D/g, '').slice(0, 8) || '10000001', 10),
      type: 'subscriptions',
      attributes: {
        store_id: parseInt(process.env.LEMONSQUEEZY_STORE_ID ?? '1', 10),
        customer_id: parseInt(custId.replace(/\D/g, '').slice(0, 8) || '10000001', 10),
        order_id: parseInt(body.orderId ?? `${Math.floor(100000 + Math.random() * 900000)}`, 10),
        product_id: 10001,
        variant_id: parseInt(variantId.replace(/\D/g, '').slice(0, 8) || '10000001', 10),
        product_name: `Gablura ${planName}`,
        variant_name: `${planName} - ${cycle}`,
        user_name: 'Dev User',
        user_email: 'dev@example.com',
        status,
        status_formatted: status.charAt(0).toUpperCase() + status.slice(1),
        renews_at: now,
        ends_at: cancelled ? now : null,
        created_at: now,
        updated_at: now,
        test_mode: true,
        cancelled,
        trial_ends_at: status === 'on_trial' ? periodEnd : null,
        card_last_four: '4242',
        payment_processor: 'stripe',
      },
    },
  };
}

function buildOrderPayload(body: SimulateWebhookBody) {
  const orderId = body.orderId ?? `ls_dev_order_${randomUUID().slice(0, 8)}`;
  const custId = body.customerId ?? `ls_dev_cust_${randomUUID().slice(0, 8)}`;
  const planName = body.planName ?? 'PRO';
  const cycle = body.billingCycle ?? 'MONTHLY';
  const variantId = body.variantId ?? FALLBACK_VARIANTS[planName]?.[cycle] ?? 'ls_var_dev';
  const total = body.total ?? 999;
  const now = new Date().toISOString();
  const status = body.status ?? 'paid';

  return {
    meta: {
      event_name: body.eventName,
      custom_data: {
        workspaceId: body.workspaceId ?? 'dev_workspace_001',
        ownerId: body.ownerId ?? 'dev_owner_001',
        planName,
        billingCycle: cycle,
        ...body.customData,
      },
    },
    data: {
      id: parseInt(orderId.replace(/\D/g, '').slice(0, 8) || '20000001', 10),
      type: 'orders',
      attributes: {
        store_id: parseInt(process.env.LEMONSQUEEZY_STORE_ID ?? '1', 10),
        customer_id: parseInt(custId.replace(/\D/g, '').slice(0, 8) || '10000001', 10),
        identifier: orderId,
        order_number: Math.floor(1000 + Math.random() * 9000),
        order_number_formatted: `#${Math.floor(1000 + Math.random() * 9000)}`,
        status,
        status_formatted: status.charAt(0).toUpperCase() + status.slice(1),
        user_name: 'Dev User',
        user_email: 'dev@example.com',
        total,
        refund_total: body.eventName === 'order_refunded' ? total : 0,
        subtotal: total,
        discount_total: 0,
        tax: 0,
        currency: 'USD',
        created_at: now,
        updated_at: now,
        test_mode: true,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Route: POST /dev/webhooks/lemonsqueezy/simulate
// ---------------------------------------------------------------------------

router.post(
  '/dev/webhooks/lemonsqueezy/simulate',
  raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    // Safety: refuse in production
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    // The route-level raw() middleware puts a Buffer on req.body.
    // Parse it into an object so we can read eventName, workspaceId, etc.
    let body: SimulateWebhookBody;
    if (Buffer.isBuffer(req.body)) {
      body = JSON.parse(req.body.toString('utf-8')) as SimulateWebhookBody;
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body) as SimulateWebhookBody;
    } else {
      body = req.body as SimulateWebhookBody;
    }

    if (!body.eventName) {
      res.status(400).json({
        error: 'Missing eventName',
        supportedEvents: [
          'subscription_created',
          'subscription_updated',
          'subscription_cancelled',
          'subscription_resumed',
          'subscription_expired',
          'subscription_paused',
          'subscription_unpaused',
          'subscription_payment_success',
          'subscription_payment_failed',
          'subscription_payment_recovered',
          'order_created',
          'order_refunded',
        ],
      });
      return;
    }

    // Build the payload based on event type
    const isOrderEvent = body.eventName.startsWith('order_');
    const payload = isOrderEvent
      ? buildOrderPayload(body)
      : buildSubscriptionPayload(body);

    // Serialize to JSON
    const rawBody = JSON.stringify(payload);

    // Sign with HMAC-SHA256 (same as production)
    let webhookSecret: string;
    try {
      webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';
      if (!webhookSecret) {
        // For simulation, use a dev fallback secret
        webhookSecret = 'ls_dev_webhook_secret_for_testing_only';
      }
    } catch {
      webhookSecret = 'ls_dev_webhook_secret_for_testing_only';
    }

    const signature = createHmac('sha256', webhookSecret)
      .update(rawBody, 'utf-8')
      .digest('hex');

    // Create a mock Express request/response to forward to the real handler
    // Spread original request first, then override webhook-specific properties
    const mockReq = Object.assign({}, req, {
      body: Buffer.from(rawBody, 'utf-8'),
      headers: {
        'x-signature': signature,
        'content-type': 'application/json',
      },
      method: 'POST' as const,
      path: '/webhooks/billing',
    }) as unknown as Request;

    let handlerStatus = 200;
    let handlerBody: any = {};

    const mockRes = {
      status: (code: number) => {
        handlerStatus = code;
        return mockRes;
      },
      json: (data: any) => {
        handlerBody = data;
        return mockRes;
      },
    } as unknown as Response;

    try {
      await webhookHandler(mockReq, mockRes);
    } catch (err) {
      handlerStatus = 500;
      handlerBody = {
        error: 'Webhook handler threw an error',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    // Return the simulation result
    res.status(handlerStatus).json({
      success: handlerStatus === 200,
      event: {
        eventName: body.eventName,
        subscriptionId: payload.data?.id,
        workspaceId: body.workspaceId ?? 'dev_workspace_001',
        planName: body.planName ?? 'PRO',
        status: body.status ?? 'active',
      },
      webhook: {
        signature,
        payloadPreview: {
          meta: payload.meta,
          dataId: payload.data?.id,
          dataType: payload.data?.type,
        },
      },
      handlerResponse: handlerBody,
    });
  },
);

// ---------------------------------------------------------------------------
// Route: GET /dev/webhooks/lemonsqueezy/events
// Lists all supported simulation events with descriptions
// ---------------------------------------------------------------------------

router.get(
  '/dev/webhooks/lemonsqueezy/events',
  (_req: Request, res: Response): void => {
    if (process.env.NODE_ENV === 'production') {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json({
      events: [
        {
          name: 'subscription_created',
          description: 'New subscription created (after checkout)',
          mapsTo: 'SUBSCRIPTION_CREATED',
          defaults: { status: 'active' },
        },
        {
          name: 'subscription_updated',
          description: 'Subscription updated (plan change, renewal)',
          mapsTo: 'SUBSCRIPTION_UPDATED',
          defaults: { status: 'active' },
        },
        {
          name: 'subscription_cancelled',
          description: 'Subscription cancelled by user or system',
          mapsTo: 'SUBSCRIPTION_CANCELED',
          defaults: { status: 'cancelled', cancelled: true },
        },
        {
          name: 'subscription_resumed',
          description: 'Cancelled subscription resumed',
          mapsTo: 'SUBSCRIPTION_ACTIVATED',
          defaults: { status: 'active', cancelled: false },
        },
        {
          name: 'subscription_expired',
          description: 'Subscription expired after grace period',
          mapsTo: 'SUBSCRIPTION_CANCELED',
          defaults: { status: 'cancelled', cancelled: true },
        },
        {
          name: 'subscription_paused',
          description: 'Subscription paused',
          mapsTo: 'SUBSCRIPTION_PAUSED',
          defaults: { status: 'paused' },
        },
        {
          name: 'subscription_unpaused',
          description: 'Paused subscription resumed',
          mapsTo: 'SUBSCRIPTION_RESUMED',
          defaults: { status: 'active' },
        },
        {
          name: 'subscription_payment_success',
          description: 'Recurring payment succeeded',
          mapsTo: 'INVOICE_PAID',
          defaults: {},
        },
        {
          name: 'subscription_payment_failed',
          description: 'Recurring payment failed',
          mapsTo: 'INVOICE_PAYMENT_FAILED',
          defaults: {},
        },
        {
          name: 'subscription_payment_recovered',
          description: 'Failed payment recovered (retry succeeded)',
          mapsTo: 'INVOICE_PAID',
          defaults: {},
        },
        {
          name: 'order_created',
          description: 'New order (initial payment)',
          mapsTo: 'INVOICE_CREATED',
          defaults: { total: 999 },
        },
        {
          name: 'order_refunded',
          description: 'Order refunded',
          mapsTo: 'REFUND_CREATED',
          defaults: { total: 999 },
        },
      ],
      usage: {
        method: 'POST',
        url: '/dev/webhooks/lemonsqueezy/simulate',
        body: {
          eventName: 'subscription_created',
          workspaceId: '<workspace-id>',
          ownerId: '<owner-id>',
          planName: 'PRO',
          billingCycle: 'MONTHLY',
          status: 'active',
        },
        example: `curl -X POST http://localhost:5000/dev/webhooks/lemonsqueezy/simulate \\
  -H "Content-Type: application/json" \\
  -d '{"eventName":"subscription_created","workspaceId":"ws_123","planName":"PRO","billingCycle":"MONTHLY"}'`,
      },
    });
  },
);

export default router;
