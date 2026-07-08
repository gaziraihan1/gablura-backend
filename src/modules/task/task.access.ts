import { prisma }                              from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError }       from '../../errors/index.js';
import type { EditPermissionResult }           from './task.types.js';
import { taskPermissionInclude }               from './task.selects.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const TaskAccess = {
  async checkEditPermission(
  taskId: string,
  userId: string,
): Promise<EditPermissionResult & { task?: any }> {
  const cacheKey = CACHE_KEYS.taskEdit(taskId, userId);
  return CacheClient.getOrSet(
    cacheKey,
    async () => {
      const task = await prisma.task.findFirst({
        where: { id: taskId },
        select: {
          id:          true,
          createdById: true,
          projectId:   true,
          workspaceId: true,
        },
      });

      if (!task) return { canEdit: false, reason: 'Task not found' };

      // Task owner can always edit
      if (task.createdById === userId) return { canEdit: true, task };

      // Personal tasks (no project/workspace) — only owner can edit
      if (!task.workspaceId) {
        return { canEdit: false, reason: 'Only the task owner can edit personal tasks' };
      }

      // Check workspace membership directly — same pattern as buildWorkspaceTasksFilter
      const workspaceMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: task.workspaceId, userId },
        select: { role: true },
      });

      const isWorkspaceAdmin =
        workspaceMember?.role === 'OWNER' || workspaceMember?.role === 'ADMIN';

      if (isWorkspaceAdmin) return { canEdit: true, task };

      // Check workspace owner directly (ownerId field on Workspace)
      const workspace = await prisma.workspace.findFirst({
        where: { id: task.workspaceId, ownerId: userId },
        select: { id: true },
      });

      if (workspace) return { canEdit: true, task };

      // Check project manager role
      if (task.projectId) {
        const projectMember = await prisma.projectMember.findFirst({
          where: { projectId: task.projectId, userId, role: 'MANAGER' },
          select: { id: true },
        }).catch(() => null); // in case ProjectMember model doesn't exist

        if (projectMember) return { canEdit: true, task };
      }

      return {
        canEdit: false,
        reason: 'Only task owner, project managers, or workspace admins can edit this task',
      };
    },
    CACHE_TTL.ACCESS_CONTROL_TASK_EDIT,
  );
},

  async assertTaskAccess(taskId: string, userId: string) {
    const cacheKey = CACHE_KEYS.taskAccess(taskId, userId);
    const task = await CacheClient.getOrSet(
      cacheKey,
      () =>
        prisma.task.findFirst({
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
        }),
      CACHE_TTL.ACCESS_CONTROL_TASK_ACCESS,
    );

    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    return task;
  },

  async assertDeletePermission(taskId: string, userId: string) {
  const task = await prisma.task.findUnique({
    where:  { id: taskId },
    select: {
      id:          true,
      title:       true,
      createdById: true,
      projectId:   true,
      workspaceId: true,
      status:      true,
      priority:    true,
      dueDate:     true,
    },
  });

  if (!task) throw new ForbiddenError('You do not have permission to delete this task');

  // Creator can always delete
  if (task.createdById === userId) return task;

  // No workspace = personal task, only creator can delete
  if (!task.workspaceId) {
    throw new ForbiddenError('You do not have permission to delete this task');
  }

  // Direct workspace membership check
  const workspaceMember = await prisma.workspaceMember.findFirst({
    where: { workspaceId: task.workspaceId, userId },
    select: { role: true },
  });

  if (workspaceMember?.role === 'OWNER' || workspaceMember?.role === 'ADMIN') {
    return task;
  }

  // Check workspace ownerId directly
  const workspace = await prisma.workspace.findFirst({
    where: { id: task.workspaceId, ownerId: userId },
    select: { id: true },
  });

  if (workspace) return task;

  throw new ForbiddenError('You do not have permission to delete this task');
},
};