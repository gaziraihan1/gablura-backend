import { prisma } from '../../lib/prisma.js';
import { IntegrationAccess } from './integration.access.js';
import { NotFoundError } from '../../errors/index.js';
import type { IntegrationProvider, IntegrationConfig } from './integration.types.js';
import * as OAuth from './integration.oauth.js';
import * as Sync from './integration.sync.js';
import * as Webhook from './integration.webhook.js';

// ─── Integration Mutation ─────────────────────────────────────────────────────
// This is the main entry point that delegates to focused modules:
// - integration.oauth.ts: OAuth flow, token exchange, token refresh
// - integration.sync.ts: Data synchronization operations
// - integration.webhook.ts: Webhook handling and processing

export class IntegrationMutation {
  // ─── OAuth ────────────────────────────────────────────────────────────────

  static async generateAuthUrl(
    provider: IntegrationProvider,
    userId: string,
    workspaceId?: string,
  ): Promise<string> {
    return OAuth.generateAuthUrl(provider, userId, workspaceId);
  }

  static async handleOAuthCallback(code: string, state: string, userId: string) {
    return OAuth.handleOAuthCallback(code, state, userId);
  }

  static async getValidAccessToken(integrationId: string): Promise<string | null> {
    return OAuth.getValidAccessToken(integrationId);
  }

  // ─── Disconnect ───────────────────────────────────────────────────────────

  static async disconnectIntegration(integrationId: string, userId: string) {
    await IntegrationAccess.enforceCanManage(integrationId, userId);

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new NotFoundError('Integration');
    }

    // Revoke tokens with provider (best effort)
    try {
      await OAuth.revokeProviderTokens(integration.provider, integration.accessToken);
    } catch {
      // Log but don't fail - we still want to disconnect locally
      console.error(`Failed to revoke tokens for ${integration.provider}`);
    }

    // Delete the integration
    await prisma.integration.delete({
      where: { id: integrationId },
    });

    return { success: true };
  }

  // ─── Configuration ────────────────────────────────────────────────────────

  static async updateConfig(integrationId: string, config: IntegrationConfig, userId: string) {
    await IntegrationAccess.enforceCanManage(integrationId, userId);

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new NotFoundError('Integration');
    }

    // Merge with existing config
    const existingConfig = (integration.config as IntegrationConfig) || {};
    const updatedConfig = { ...existingConfig, ...config };

    return prisma.integration.update({
      where: { id: integrationId },
      data: { config: updatedConfig },
    });
  }

  // ─── Sync ─────────────────────────────────────────────────────────────────

  static async triggerSync(integrationId: string, userId: string) {
    return Sync.triggerSync(integrationId, userId);
  }

  static async performSync(integrationId: string) {
    return Sync.performSync(integrationId);
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────────

  static async handleWebhook(provider: string, payload: Record<string, unknown>, signature?: string, slackTimestamp?: string) {
    return Webhook.handleWebhook(provider, payload, signature, slackTimestamp);
  }

  static async processWebhookEvent(
    provider: string,
    integrationId: string,
    payload: Record<string, unknown>,
    signature?: string,
    timestamp?: string,
  ) {
    return Webhook.processWebhookEvent(provider, integrationId, payload, signature, timestamp);
  }
}
