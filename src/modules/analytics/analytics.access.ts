import { prisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError, PlanLimitError } from '../../errors/index.js';

export const AnalyticsAccess = {
  async assertWorkspaceAdminOrOwner(userId: string, workspaceId: string) {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });

    if (!member) {
      throw new ForbiddenError('You do not have access to this workspace');
    }
    if (member.role !== 'ADMIN' && member.role !== 'OWNER') {
      throw new ForbiddenError('Analytics access is restricted to workspace admins and owners');
    }

    return member;
  },

  async assertAnalyticsAccess(userId: string, workspaceId: string) {
    const workspace = await prisma.workspace.findUnique({
      where:  { id: workspaceId },
      select: { plan: true },
    });

    if (!workspace) throw new NotFoundError('Workspace');

    if (workspace.plan === 'FREE') {
      throw new PlanLimitError('Upgrade your workspace plan to access analytics');
    }

    await this.assertWorkspaceAdminOrOwner(userId, workspaceId);
  },

  async assertProjectAnalyticsAccess(userId: string, workspaceId: string, projectId: string) {
    const workspace = await prisma.workspace.findUnique({
      where:  { id: workspaceId },
      select: { plan: true },
    });

    if (!workspace) throw new NotFoundError('Workspace');

    if (workspace.plan === 'FREE') {
      throw new PlanLimitError('Upgrade your workspace plan to access analytics');
    }

    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });

    if (!member) {
      throw new ForbiddenError('You do not have access to this workspace');
    }

    const isAdminOrOwner = member.role === 'ADMIN' || member.role === 'OWNER';

    if (!isAdminOrOwner) {
      const isProjectManager = await prisma.project.findFirst({
        where: {
          id: projectId,
          members: { some: { userId, role: 'MANAGER' } },
        },
        select: { id: true },
      });

      if (!isProjectManager) {
        throw new ForbiddenError('Analytics access is restricted to workspace admins, owners, or project managers');
      }
    }
  },

  async isWorkspaceAdminOrOwner(userId: string, workspaceId: string): Promise<boolean> {
    const member = await prisma.workspaceMember.findUnique({
      where:  { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });
    return member?.role === 'ADMIN' || member?.role === 'OWNER';
  },

  async getUserAdminWorkspaces(userId: string): Promise<string[]> {
    const memberships = await prisma.workspaceMember.findMany({
      where:  { userId, role: { in: ['ADMIN', 'OWNER'] } },
      select: { workspaceId: true },
    });
    return memberships
      .map((m) => m.workspaceId)
      .filter((id): id is string => id !== null);
  },
};