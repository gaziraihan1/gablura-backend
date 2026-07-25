import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import { prisma } from '../../lib/prisma.js';
import { IntegrationQuery } from './integration.query.js';
import { IntegrationMutation } from './integration.mutation.js';
import { IntegrationAccess } from './integration.access.js';
import {
  createIntegrationSchema,
  oauthCallbackSchema,
  updateIntegrationConfigSchema,
  getIntegrationParamsSchema,
  workspaceIntegrationParamsSchema,
  workspaceIntegrationBodySchema,
} from './integration.validators.js';

// ─── Personal Integrations ────────────────────────────────────────────────────

/**
 * GET /api/v1/user/integrations
 * Get all personal integrations for the current user
 */
export const getUserIntegrations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const integrations = await IntegrationQuery.getUserIntegrations(req.user!.id);
  res.json({ success: true, data: integrations });
});

/**
 * POST /api/v1/user/integrations/auth
 * Generate OAuth URL for connecting a provider
 */
export const initiateOAuth = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createIntegrationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.issues);
  }

  const { provider, workspaceId } = parsed.data;

  // If workspace integration, check admin access
  if (workspaceId) {
    await IntegrationAccess.enforceCanConnectToWorkspace(workspaceId, req.user!.id);
  }

  const authUrl = await IntegrationMutation.generateAuthUrl(
    provider,
    req.user!.id,
    workspaceId,
  );

  res.json({ success: true, data: { authUrl } });
});

/**
 * POST /api/v1/user/integrations
 * Connect a provider (fallback for backward compatibility)
 */
export const connectIntegration = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createIntegrationSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.issues);
  }

  const { provider, workspaceId } = parsed.data;

  // If workspace integration, check admin access
  if (workspaceId) {
    await IntegrationAccess.enforceCanConnectToWorkspace(workspaceId, req.user!.id);
  }

  // Generate auth URL and redirect
  const authUrl = await IntegrationMutation.generateAuthUrl(
    provider,
    req.user!.id,
    workspaceId,
  );

  res.json({ success: true, data: { authUrl } });
});

/**
 * POST /api/v1/user/integrations/callback
 * Handle OAuth callback - exchange code for tokens
 */
export const handleOAuthCallback = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = oauthCallbackSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.issues);
  }

  const { code, state } = parsed.data;

  const integration = await IntegrationMutation.handleOAuthCallback(
    code,
    state,
    req.user!.id,
  );

  res.json({ success: true, data: { integration } });
});

/**
 * DELETE /api/v1/user/integrations/:id
 * Disconnect an integration
 */
export const disconnectIntegration = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = getIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  await IntegrationMutation.disconnectIntegration(paramsParsed.data.id, req.user!.id);

  res.json({ success: true, message: 'Integration disconnected' });
});

/**
 * PUT /api/v1/user/integrations/:id/config
 * Update integration configuration
 */
export const updateIntegrationConfig = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = getIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const bodyParsed = updateIntegrationConfigSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new ValidationError('Validation error', bodyParsed.error.issues);
  }

  const integration = await IntegrationMutation.updateConfig(
    paramsParsed.data.id,
    bodyParsed.data.config,
    req.user!.id,
  );

  res.json({ success: true, data: { integration } });
});

/**
 * POST /api/v1/user/integrations/:id/sync
 * Trigger manual sync for an integration
 */
export const triggerSync = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = getIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const result = await IntegrationMutation.triggerSync(paramsParsed.data.id, req.user!.id);

  res.json({ success: true, data: result });
});

/**
 * GET /api/v1/user/integrations/stats
 * Get integration statistics
 */
export const getIntegrationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const stats = await IntegrationQuery.getUserIntegrationStats(req.user!.id);
  res.json({ success: true, data: stats });
});

// ─── Workspace Integrations ───────────────────────────────────────────────────

/**
 * GET /api/v1/workspace-integrations/:slug
 * Get all integrations for a workspace
 */
export const getWorkspaceIntegrations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = workspaceIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: paramsParsed.data.slug },
    select: { id: true },
  });

  if (!workspace) {
    throw new ValidationError('Workspace not found');
  }

  const integrations = await IntegrationQuery.getWorkspaceIntegrations(workspace.id);
  res.json({ success: true, data: integrations });
});

/**
 * POST /api/v1/workspace-integrations/:slug/auth
 * Generate OAuth URL for workspace integration
 */
export const initiateWorkspaceOAuth = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = workspaceIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const bodyParsed = workspaceIntegrationBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new ValidationError('Validation error', bodyParsed.error.issues);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: paramsParsed.data.slug },
    select: { id: true },
  });

  if (!workspace) {
    throw new ValidationError('Workspace not found');
  }

  // Check admin access
  await IntegrationAccess.enforceCanConnectToWorkspace(workspace.id, req.user!.id);

  const authUrl = await IntegrationMutation.generateAuthUrl(
    bodyParsed.data.provider,
    req.user!.id,
    workspace.id,
  );

  res.json({ success: true, data: { authUrl } });
});

/**
 * POST /api/v1/workspace-integrations/:slug
 * Connect integration to workspace (admin only)
 */
export const connectWorkspaceIntegration = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = workspaceIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const bodyParsed = workspaceIntegrationBodySchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new ValidationError('Validation error', bodyParsed.error.issues);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug: paramsParsed.data.slug },
    select: { id: true },
  });

  if (!workspace) {
    throw new ValidationError('Workspace not found');
  }

  // Check admin access
  await IntegrationAccess.enforceCanConnectToWorkspace(workspace.id, req.user!.id);

  // Generate auth URL
  const authUrl = await IntegrationMutation.generateAuthUrl(
    bodyParsed.data.provider,
    req.user!.id,
    workspace.id,
  );

  res.json({ success: true, data: { authUrl } });
});

/**
 * DELETE /api/v1/workspace-integrations/:slug/:id
 * Disconnect workspace integration (admin only)
 */
export const disconnectWorkspaceIntegration = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = getIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  await IntegrationMutation.disconnectIntegration(paramsParsed.data.id, req.user!.id);

  res.json({ success: true, message: 'Integration disconnected' });
});

/**
 * PUT /api/v1/workspace-integrations/:id/config
 * Update workspace integration config (admin only)
 */
export const updateWorkspaceIntegrationConfig = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = getIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const bodyParsed = updateIntegrationConfigSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new ValidationError('Validation error', bodyParsed.error.issues);
  }

  const integration = await IntegrationMutation.updateConfig(
    paramsParsed.data.id,
    bodyParsed.data.config,
    req.user!.id,
  );

  res.json({ success: true, data: { integration } });
});

/**
 * POST /api/v1/workspace-integrations/:id/sync
 * Trigger workspace sync (admin only)
 */
export const triggerWorkspaceSync = asyncHandler(async (req: AuthRequest, res: Response) => {
  const paramsParsed = getIntegrationParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    throw new ValidationError('Validation error', paramsParsed.error.issues);
  }

  const result = await IntegrationMutation.triggerSync(paramsParsed.data.id, req.user!.id);

  res.json({ success: true, data: result });
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/webhooks/:provider
 * Handle webhook from provider
 */
export const handleWebhook = asyncHandler(async (req: AuthRequest, res: Response) => {
  const provider = req.params.provider;
  const signature = req.headers['x-hub-signature-256'] as string ||
                    req.headers['x-slack-signature'] as string ||
                    req.headers['x-goog-signature'] as string;

  await IntegrationMutation.handleWebhook(provider, req.body, signature);

  res.json({ success: true });
});
