import { prisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../../errors/index.js';

// ─── Integration Access Control ───────────────────────────────────────────────

export class IntegrationAccess {
  /**
   * Check if user can view an integration
   * - Personal integrations: only the owner can view
   * - Workspace integrations: all workspace members can view
   */
  static async canView(integrationId: string, userId: string): Promise<boolean> {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { userId: true, workspaceId: true },
    });

    if (!integration) {
      throw new NotFoundError('Integration');
    }

    // Personal integration - only owner can view
    if (integration.userId) {
      return integration.userId === userId;
    }

    // Workspace integration - all members can view
    if (integration.workspaceId) {
      return this.isWorkspaceMember(integration.workspaceId, userId);
    }

    return false;
  }

  /**
   * Check if user can manage (connect/disconnect/configure) an integration
   * - Personal integrations: only the owner can manage
   * - Workspace integrations: only admins/owners can manage
   */
  static async canManage(integrationId: string, userId: string): Promise<boolean> {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { userId: true, workspaceId: true },
    });

    if (!integration) {
      throw new NotFoundError('Integration');
    }

    // Personal integration - only owner can manage
    if (integration.userId) {
      return integration.userId === userId;
    }

    // Workspace integration - only admins/owners can manage
    if (integration.workspaceId) {
      return this.isWorkspaceAdmin(integration.workspaceId, userId);
    }

    return false;
  }

  /**
   * Check if user can connect an integration to a workspace
   * Only workspace admins/owners can do this
   */
  static async canConnectToWorkspace(workspaceId: string, userId: string): Promise<boolean> {
    return this.isWorkspaceAdmin(workspaceId, userId);
  }

  /**
   * Check if user is a member of the workspace
   */
  static async isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
      },
    });

    return !!membership;
  }

  /**
   * Check if user is an admin/owner of the workspace
   */
  static async isWorkspaceAdmin(workspaceId: string, userId: string): Promise<boolean> {
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
      },
      select: { role: true },
    });

    return membership?.role === 'ADMIN' || membership?.role === 'OWNER';
  }

  /**
   * Get user's workspace membership role
   */
  static async getWorkspaceRole(workspaceId: string, userId: string): Promise<string | null> {
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        userId,
        workspaceId,
      },
      select: { role: true },
    });

    return membership?.role || null;
  }

  /**
   * Ensure user can view integration or throw
   */
  static async enforceCanView(integrationId: string, userId: string): Promise<void> {
    const canView = await this.canView(integrationId, userId);
    if (!canView) {
      throw new ForbiddenError('You do not have permission to view this integration');
    }
  }

  /**
   * Ensure user can manage integration or throw
   */
  static async enforceCanManage(integrationId: string, userId: string): Promise<void> {
    const canManage = await this.canManage(integrationId, userId);
    if (!canManage) {
      throw new ForbiddenError('You do not have permission to manage this integration');
    }
  }

  /**
   * Ensure user can connect to workspace or throw
   */
  static async enforceCanConnectToWorkspace(workspaceId: string, userId: string): Promise<void> {
    const canConnect = await this.canConnectToWorkspace(workspaceId, userId);
    if (!canConnect) {
      throw new ForbiddenError('Only workspace admins can connect integrations');
    }
  }
}
