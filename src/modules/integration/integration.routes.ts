import { Router } from 'express';
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

const webhookRouter = Router();

// POST /api/v1/webhooks/:provider - Handle provider webhooks
webhookRouter.post('/:provider', handleWebhook);

export { router as integrationRouter, workspaceRouter as workspaceIntegrationRouter, webhookRouter as integrationWebhookRouter };
