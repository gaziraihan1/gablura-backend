import { prisma }                              from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError }       from '../../errors/index.js';
import type { EditPermissionResult }           from './task.types.js';
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
      // Single query: fetch task + workspace member role + workspace owner + project member
      // in one round-trip instead of 4 sequential queries
      const task = await prisma.task.findFirst({
        where: { id: taskId },
        select: {
          id:          true,
          createdById: true,
          projectId:   true,
          workspaceId: true,
          status:      true,
          assignees:   { select: { userId: true } },
          workspace:   {
            select: {
              ownerId: true,
              members: {
                where: { userId },
                select: { role: true },
                take:   1,
              },
            },
          },
          project: {
            select: {
              members: {
                where: { userId, role: 'MANAGER' },
                select: { id: true },
                take:   1,
              },
            },
          },
        },
      });

      if (!task) return { canEdit: false, reason: 'Task not found' };

      // Task owner can always edit
      if (task.createdById === userId) return { canEdit: true, task };

      // Personal tasks (no project/workspace) — only owner can edit
      if (!task.workspaceId) {
        return { canEdit: false, reason: 'Only the task owner can edit personal tasks' };
      }

      // Workspace admin check (from pre-fetched data)
      const workspaceMemberRole = task.workspace?.members?.[0]?.role;
      const isWorkspaceAdmin =
        workspaceMemberRole === 'OWNER' || workspaceMemberRole === 'ADMIN';

      if (isWorkspaceAdmin) return { canEdit: true, task };

      // Workspace owner check (from pre-fetched data)
      if (task.workspace?.ownerId === userId) return { canEdit: true, task };

      // Project manager check (from pre-fetched data)
      if (task.project?.members?.length) return { canEdit: true, task };

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
  // Single query: fetch task + workspace member role + workspace owner in one round-trip
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
      workspace:   {
        select: {
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
            take:   1,
          },
        },
      },
    },
  });

  if (!task) throw new ForbiddenError('You do not have permission to delete this task');

  // Creator can always delete
  if (task.createdById === userId) return task;

  // No workspace = personal task, only creator can delete
  if (!task.workspaceId) {
    throw new ForbiddenError('You do not have permission to delete this task');
  }

  // Workspace admin/owner check (from pre-fetched data — no extra query)
  const workspaceMemberRole = task.workspace?.members?.[0]?.role;
  if (workspaceMemberRole === 'OWNER' || workspaceMemberRole === 'ADMIN') return task;
  if (task.workspace?.ownerId === userId) return task;

  throw new ForbiddenError('You do not have permission to delete this task');
},
};