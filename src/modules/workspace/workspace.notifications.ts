import { prisma } from '../../lib/prisma.js';
import { notifyUser, notifyUsers } from '../notification/notification.helpers.js';

export const WorkspaceNotifications = {
  async notifyInvited(params: {
    invitedUserId: string;
    inviterId:     string;
    inviterName:   string;
    workspaceName: string;
    token:         string;
  }): Promise<void> {
    try {
      await notifyUser({
        userId:    params.invitedUserId,
        senderId:  params.inviterId,
        type:      'WORKSPACE_INVITE',
        title:     'Workspace Invitation',
        message:   `${params.inviterName} invited you to join ${params.workspaceName}`,
        actionUrl: `/dashboard/workspaces/invitations/${params.token}`,
      });
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to send invite notification:', err);
    }
  },

  async notifyAccepted(params: {
    inviterId:     string;
    userId:        string;
    userName:      string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<void> {
    try {
      await notifyUser({
        userId:    params.inviterId,
        senderId:  params.userId,
        type:      'MEMBER_JOINED',
        title:     'Invitation Accepted',
        message:   `${params.userName} accepted your invitation to ${params.workspaceName}`,
        actionUrl: `/dashboard/workspaces/${params.workspaceSlug}`,
      });
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to send accepted notification:', err);
    }
  },

  async notifyAdmins(params: {
    workspaceId:   string;
    excludeUserId: string;
    senderId:      string;
    senderName:    string;
    workspaceName: string;
    workspaceSlug: string;
  }): Promise<void> {
    try {
      const admins = await prisma.workspaceMember.findMany({
        where: {
          workspaceId: params.workspaceId,
          role:        { in: ['OWNER', 'ADMIN'] },
          userId:      { not: params.excludeUserId },
        },
        include: { user: { select: { id: true, notifications: true } } },
      });

      const targets = admins
        .filter((a) => a.user.notifications)
        .map((a) => a.userId);

      // ✅ 1 INSERT for all eligible admins instead of N serial inserts
      await notifyUsers(
        targets.map((userId) => ({
          userId,
          senderId:  params.senderId,
          type:      'MEMBER_JOINED' as const,
          title:     'New Member Joined',
          message:   `${params.senderName} joined ${params.workspaceName}`,
          actionUrl: `/dashboard/workspaces/${params.workspaceSlug}/members`,
        })),
      );
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to send admin notifications:', err);
    }
  },

  async notifyRemoved(params: {
    removedUserId: string;
    removerId:     string;
    workspaceName: string;
  }): Promise<void> {
    try {
      await notifyUser({
        userId:   params.removedUserId,
        senderId: params.removerId,
        type:     'MEMBER_REMOVED',
        title:    'Removed from Workspace',
        message:  `You have been removed from ${params.workspaceName}`,
      });
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to send removal notification:', err);
    }
  },

  async notifyRoleChanged(params: {
    userId:        string;
    updaterId:     string;
    workspaceName: string;
    workspaceId:   string;
    role:          string;
  }): Promise<void> {
    try {
      await notifyUser({
        userId:    params.userId,
        senderId:  params.updaterId,
        type:      'ROLE_UPDATED',
        title:     'Role Updated',
        message:   `Your role in ${params.workspaceName} has been changed to ${params.role}`,
        actionUrl: `/dashboard/workspaces/${params.workspaceId}`,
      });
    } catch (err) {
      console.error('[WorkspaceNotifications] Failed to send role change notification:', err);
    }
  },
};