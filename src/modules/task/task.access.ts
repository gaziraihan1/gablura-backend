import { prisma }                              from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError }       from '../../errors/index.js';
import type { EditPermissionResult }           from './task.types.js';
import { taskPermissionInclude }               from './task.selects.js';

export const TaskAccess = {
  async checkEditPermission(
    taskId: string,
    userId: string,
  ): Promise<EditPermissionResult & { task?: any }> {
    const task = await prisma.task.findFirst({
      where:   { id: taskId },
      include: taskPermissionInclude,
    });

    if (!task) return { canEdit: false, reason: 'Task not found' };

    const isOwner        = task.createdById === userId;
    const isPersonalTask = !task.projectId;

    if (isPersonalTask) {
      if (!isOwner) return { canEdit: false, reason: 'Only the task owner can edit personal tasks' };
      return { canEdit: true, task };
    }

    const projectMember    = task.project?.members?.find((m) => m.userId === userId);
    const isProjectManager = projectMember?.role === 'MANAGER';

    const workspaceMember  = task.project?.workspace?.members?.find((m) => m.userId === userId);
    const isWorkspaceAdmin = workspaceMember?.role === 'OWNER' || workspaceMember?.role === 'ADMIN';

    const canEdit = isOwner || isProjectManager || isWorkspaceAdmin;

    if (!canEdit) {
      return {
        canEdit: false,
        reason:  'Only task owner, project managers, or workspace admins can edit this task',
      };
    }

    return { canEdit: true, task };
  },

  async assertTaskAccess(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { members: { some: { userId } } } },
          {
            project: {
              workspace: {
                OR: [
                  { ownerId: userId },
                  { members: { some: { userId, role: 'ADMIN' } } },
                ],
              },
            },
          },
        ],
      },
    });

    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    return task;
  },

  async assertDeletePermission(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          {
            project: {
              workspace: {
                members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } },
              },
            },
          },
        ],
      },
    });

    if (!task) throw new ForbiddenError('You do not have permission to delete this task');
    return task;
  },
};