import { prisma } from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

export const ActivityAccess = {
  async canAccessWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
    });
    return !!workspace;
  },
  async isPublicWorkspace(workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isPublic: true },
    });
    return workspace?.isPublic ?? false;
  },

  async canAccessTask(userId: string, taskId: string): Promise<boolean> {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          {
            project: {
              workspace: {
                OR: [
                  { ownerId: userId },
                  { members: { some: { userId } } },
                ],
              },
            },
          },
        ],
      },
    });
    return !!task;
  },

  async isWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } } },
        ],
      },
    });
    return !!workspace;
  },

  async assertCanDelete(callerId: string, activityId: string): Promise<void> {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity) throw new NotFoundError('Activity');

    if (activity.userId === callerId) return;

    if (activity.workspaceId) {
      const isAdmin = await this.isWorkspaceAdmin(callerId, activity.workspaceId);
      if (isAdmin) return;
    }

    throw new ForbiddenError('You do not have permission to delete this activity');
  },
};