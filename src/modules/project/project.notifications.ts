import { prisma } from '../../lib/prisma.js';
import { notifyUser, notifyUsers } from '../notification/notification.helpers.js';

export const ProjectNotifications = {
  /**
   * Notify a user they've been added as a member of a project.
   */
  async notifyMemberAdded(params: {
    addedUserId:   string;
    adderId:       string;
    projectName:   string;
    projectId:     string;
    workspaceSlug: string;
  }): Promise<void> {
    try {
      // Only notify if the target user has notifications enabled
      const user = await prisma.user.findUnique({
        where:  { id: params.addedUserId },
        select: { notifications: true },
      });
      if (!user?.notifications) return;

      const adder = await prisma.user.findUnique({
        where:  { id: params.adderId },
        select: { name: true },
      });

      await notifyUser({
        userId:    params.addedUserId,
        senderId:  params.adderId,
        type:      'MEMBER_JOINED',
        title:     'Added to Project',
        message:   `${adder?.name ?? 'Someone'} added you to "${params.projectName}"`,
        actionUrl: `/dashboard/workspaces/${params.workspaceSlug}/projects/${params.projectId}`,
      });
    } catch (err) {
      console.error('[ProjectNotifications] Failed to send member added notification:', err);
    }
  },

  /**
   * Notify a user they've been removed from a project.
   */
  async notifyMemberRemoved(params: {
    removedUserId: string;
    removerId:     string;
    projectName:   string;
  }): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where:  { id: params.removedUserId },
        select: { notifications: true },
      });
      if (!user?.notifications) return;

      await notifyUser({
        userId:    params.removedUserId,
        senderId:  params.removerId,
        type:      'MEMBER_REMOVED',
        title:     'Removed from Project',
        message:   `You have been removed from "${params.projectName}"`,
      });
    } catch (err) {
      console.error('[ProjectNotifications] Failed to send member removed notification:', err);
    }
  },

  /**
   * Notify a user their role in a project has changed.
   */
  async notifyMemberRoleChanged(params: {
    targetUserId:  string;
    updaterId:     string;
    projectName:   string;
    projectId:     string;
    workspaceSlug: string;
    newRole:       string;
  }): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where:  { id: params.targetUserId },
        select: { notifications: true },
      });
      if (!user?.notifications) return;

      const updater = await prisma.user.findUnique({
        where:  { id: params.updaterId },
        select: { name: true },
      });

      await notifyUser({
        userId:    params.targetUserId,
        senderId:  params.updaterId,
        type:      'ROLE_UPDATED',
        title:     'Project Role Updated',
        message:   `${updater?.name ?? 'Someone'} changed your role in "${params.projectName}" to ${params.newRole}`,
        actionUrl: `/dashboard/workspaces/${params.workspaceSlug}/projects/${params.projectId}/settings`,
      });
    } catch (err) {
      console.error('[ProjectNotifications] Failed to send role change notification:', err);
    }
  },

  /**
   * Notify all project managers (MANAGER role members + workspace admins)
   * when a new member is added to the project.
   */
  async notifyManagersMemberAdded(params: {
    projectId:     string;
    projectName:   string;
    adderId:       string;
    addedUserName: string;
    workspaceId:   string;
    workspaceSlug: string;
  }): Promise<void> {
    try {
      // Find project MANAGER members
      const projectManagers = await prisma.projectMember.findMany({
        where: {
          projectId: params.projectId,
          role:      'MANAGER',
          userId:    { not: params.adderId },
        },
        select: { userId: true },
      });

      // Find workspace OWNER/ADMIN who aren't already in the project manager list
      const workspaceAdmins = await prisma.workspaceMember.findMany({
        where: {
          workspaceId: params.workspaceId,
          role:        { in: ['OWNER', 'ADMIN'] },
          userId:      { not: params.adderId },
        },
        select: { userId: true },
      });

      // Merge and deduplicate
      const managerIds = new Set([
        ...projectManagers.map((m) => m.userId),
        ...workspaceAdmins.map((a) => a.userId),
      ]);

      // Filter to users who have notifications enabled
      const eligible = await prisma.user.findMany({
        where: {
          id:           { in: Array.from(managerIds) },
          notifications: true,
        },
        select: { id: true },
      });

      if (eligible.length === 0) return;

      await notifyUsers(
        eligible.map((u) => ({
          userId:    u.id,
          senderId:  params.adderId,
          type:      'MEMBER_JOINED' as const,
          title:     'New Project Member',
          message:   `${params.addedUserName} was added to "${params.projectName}"`,
          actionUrl: `/dashboard/workspaces/${params.workspaceSlug}/projects/${params.projectId}/settings`,
        })),
      );
    } catch (err) {
      console.error('[ProjectNotifications] Failed to send manager notifications:', err);
    }
  },
};
