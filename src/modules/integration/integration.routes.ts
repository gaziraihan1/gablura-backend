import { Router, raw } from 'express';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import {
  getUserIntegrations,
  initiateOAuth,
  connectIntegration,
  handleOAuthCallback,
  disconnectIntegration,
  updateIntegrationConfig,
  triggerSync,
  getIntegrationStats,
  getWorkspaceIntegrations,
  initiateWorkspaceOAuth,
  connectWorkspaceIntegration,
  disconnectWorkspaceIntegration,
  updateWorkspaceIntegrationConfig,
  triggerWorkspaceSync,
  handleWebhook,
} from './integration.controller.js';

const router = Router();
const workspaceRouter = Router({ mergeParams: true });

// ─── Personal Integration Routes ──────────────────────────────────────────────

// GET /api/v1/user/integrations - List personal integrations
router.get('/', getUserIntegrations);

// GET /api/v1/user/integrations/stats - Get integration statistics
router.get('/stats', getIntegrationStats);

// POST /api/v1/user/integrations/auth - Generate OAuth URL
router.post('/auth', initiateOAuth);

// POST /api/v1/user/integrations - Connect integration (fallback for backward compatibility)
router.post('/', connectIntegration);

// POST /api/v1/user/integrations/callback - Handle OAuth callback
router.post('/callback', handleOAuthCallback);

// DELETE /api/v1/user/integrations/:id - Disconnect integration
router.delete('/:id', disconnectIntegration);

// PUT /api/v1/user/integrations/:id/config - Update configuration
router.put('/:id/config', updateIntegrationConfig);

// POST /api/v1/user/integrations/:id/sync - Trigger manual sync
router.post('/:id/sync', triggerSync);

// ─── Workspace Integration Routes ─────────────────────────────────────────────

// GET /api/v1/workspace-integrations/:slug - List workspace integrations
workspaceRouter.get('/:slug', getWorkspaceIntegrations);

// POST /api/v1/workspace-integrations/:slug/auth - Generate OAuth URL for workspace
workspaceRouter.post('/:slug/auth', initiateWorkspaceOAuth);

// POST /api/v1/workspace-integrations/:slug - Connect to workspace
workspaceRouter.post('/:slug', connectWorkspaceIntegration);

// DELETE /api/v1/workspace-integrations/:slug/:id - Disconnect workspace integration
workspaceRouter.delete('/:slug/:id', disconnectWorkspaceIntegration);

// PUT /api/v1/workspace-integrations/:id/config - Update workspace config
workspaceRouter.put('/:id/config', updateWorkspaceIntegrationConfig);

// POST /api/v1/workspace-integrations/:id/sync - Trigger workspace sync
workspaceRouter.post('/:id/sync', triggerWorkspaceSync);

// ─── Webhook Routes ───────────────────────────────────────────────────────────
// IMPORTANT: Use raw() middleware to preserve the original body for signature
// verification (Slack, GitHub, Trello all verify the raw body hash).
// The raw body is also parsed to JSON for the handler.

const webhookRouter = Router();

webhookRouter.post(
  '/:provider',
  rateLimitMiddleware(100, 60), // 100 requests per 60 seconds per IP
  raw({ type: 'application/json' }),
  (req, _res, next) => {
    // The raw() middleware gives us a Buffer. Parse it to JSON for the handler
    // but also keep the raw Buffer available if needed for signature verification.
    if (Buffer.isBuffer(req.body)) {
      try {
        const parsed = JSON.parse(req.body.toString('utf-8'));
        // Attach parsed body — handlers use this
        req.body = parsed;
        // Attach raw string for signature verification (Slack needs exact raw body)
        (req as any).rawBody = req.body.toString('utf-8');
      } catch {
        // If parsing fails, leave the raw buffer — handler will deal with it
      }
    }
    next();
  },
  handleWebhook,
);

export { router as integrationRouter, workspaceRouter as workspaceIntegrationRouter, webhookRouter as integrationWebhookRouter };
