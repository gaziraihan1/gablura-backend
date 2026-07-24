import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import type { IntegrationProvider, IntegrationConfig, SyncStatus } from './integration.types.js';

// ─── Integration Query ────────────────────────────────────────────────────────

export class IntegrationQuery {
  /**
   * Get all integrations for a user (personal integrations)
   */
  static async getUserIntegrations(userId: string) {
    const integrations = await prisma.integration.findMany({
      where: {
        userId,
        workspaceId: null, // Personal integrations only
      },
      orderBy: { createdAt: 'desc' },
    });

    return integrations.map(this.formatIntegrationResponse);
  }

  /**
   * Get all integrations for a workspace
   */
  static async getWorkspaceIntegrations(workspaceId: string) {
    const integrations = await prisma.integration.findMany({
      where: { workspaceId },
      include: {
        connectedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return integrations.map((integration) => ({
      ...this.formatIntegrationResponse(integration),
      connectedBy: integration.connectedBy,
    }));
  }

  /**
   * Get a single integration by ID
   */
  static async getIntegrationById(integrationId: string) {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      include: {
        connectedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!integration) {
      throw new NotFoundError('Integration');
    }

    return {
      ...this.formatIntegrationResponse(integration),
      connectedBy: integration.connectedBy,
    };
  }

  /**
   * Get integration by provider for a user
   */
  static async getIntegrationByProvider(userId: string, provider: IntegrationProvider) {
    const integration = await prisma.integration.findFirst({
      where: {
        userId,
        provider,
        workspaceId: null,
        active: true,
      },
    });

    return integration;
  }

  /**
   * Get workspace integration by provider
   */
  static async getWorkspaceIntegrationByProvider(workspaceId: string, provider: IntegrationProvider) {
    const integration = await prisma.integration.findFirst({
      where: {
        workspaceId,
        provider,
        active: true,
      },
    });

    return integration;
  }

  /**
   * Get integration with tokens (for API calls)
   */
  static async getIntegrationWithTokens(integrationId: string) {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new NotFoundError('Integration');
    }

    return integration;
  }

  /**
   * Get integration statistics for a user
   */
  static async getUserIntegrationStats(userId: string) {
    const [total, active, failed] = await Promise.all([
      prisma.integration.count({
        where: { userId, workspaceId: null },
      }),
      prisma.integration.count({
        where: { userId, workspaceId: null, active: true },
      }),
      prisma.integration.count({
        where: {
          userId,
          workspaceId: null,
          syncStatus: { path: ['lastSyncStatus'], equals: 'failed' },
        },
      }),
    ]);

    return {
      total,
      active,
      inactive: total - active,
      needsAttention: failed,
    };
  }

  /**
   * Get integration statistics for a workspace
   */
  static async getWorkspaceIntegrationStats(workspaceId: string) {
    const [total, active, failed] = await Promise.all([
      prisma.integration.count({
        where: { workspaceId },
      }),
      prisma.integration.count({
        where: { workspaceId, active: true },
      }),
      prisma.integration.count({
        where: {
          workspaceId,
          syncStatus: { path: ['lastSyncStatus'], equals: 'failed' },
        },
      }),
    ]);

    return {
      total,
      active,
      inactive: total - active,
      needsAttention: failed,
    };
  }

  /**
   * Format integration response
   */
  private static formatIntegrationResponse(integration: any) {
    return {
      id: integration.id,
      name: integration.name,
      provider: integration.provider,
      active: integration.active,
      connectedAt: integration.connectedAt,
      config: integration.config as IntegrationConfig | undefined,
      syncStatus: integration.syncStatus as SyncStatus | undefined,
      webhookUrl: integration.webhookUrl,
    };
  }
}
