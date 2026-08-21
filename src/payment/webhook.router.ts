// backend/src/payment/webhook.router.ts
//
// Single webhook endpoint. The active provider's verifyAndParseWebhook()
// handles signature verification — the router itself is provider-agnostic.
//
// IMPORTANT: must be registered BEFORE express.json() so req.body is raw Buffer.
// Rate limited to 100 requests/60s per IP to prevent abuse.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, raw } from 'express';
import { webhookHandler } from './webhook.handler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = Router();

// Rate limit: 100 webhook deliveries per 60 seconds per IP.
// Payment providers typically retry failed webhooks within minutes, so this
// ceiling is generous enough to never block legitimate traffic while still
// protecting against abuse (e.g. someone hammering the endpoint).
const webhookRateLimit = rateLimitMiddleware(100, 60);

router.post(
  '/webhooks/billing',
  webhookRateLimit,
  raw({ type: 'application/json' }),
  webhookHandler,
);

export default router;

// ---------------------------------------------------------------------------
// In app.ts:
//
//   import webhookRouter from './payment/webhook.router';
//   app.use(webhookRouter);                     ← BEFORE express.json()
//   app.use(express.json());
//   app.use('/workspaces/:workspaceId/billing', billingRouter);
//
// Webhook URL (same endpoint for all providers):
//   Stripe dashboard webhook URL:      https://yourdomain.com/webhooks/billing
//   Paddle dashboard webhook URL:      https://yourdomain.com/webhooks/billing
//   Lemon Squeezy dashboard webhook URL: https://yourdomain.com/webhooks/billing
// ---------------------------------------------------------------------------