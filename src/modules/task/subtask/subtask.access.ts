import { prisma }                              from '../../../lib/prisma.js';
import { NotFoundError, ForbiddenError }       from '../../../errors/index.js';
import type { EditSubtaskPermissionResult }    from './subtask.types.js';

export const SubtaskAccess = {
  async assertParentTaskAccess(parentTaskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id:    parentTaskId,
        depth: 0,
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
      select: {
        id:          true,
        title:       true,
        depth:       true,
        workspaceId: true,
        projectId:   true,
        createdById: true,
        assignees:   { select: { userId: true } },
      },
    });

    if (!task) throw new NotFoundError('Parent task', 'PARENT_TASK_NOT_FOUND');
    return task;
  },

  async assertCanCreateSubtask(parentTaskId: string, userId: string) {
    const task = await this.assertParentTaskAccess(parentTaskId, userId);

    const isAssignee = task.assignees.some((a) => a.userId === userId);
    const isCreator  = task.createdById === userId;

    if (!isAssignee && !isCreator) {
      throw new ForbiddenError('Only assignees or the task creator can create subtasks');
    }

    return task;
  },

  async checkEditPermission(
    subtaskId: string,
    userId:    string,
  ): Promise<EditSubtaskPermissionResult & { subtask?: any }> {
    const subtask = await prisma.task.findFirst({
      where:  { id: subtaskId, depth: 1 },
      select: {
        id:          true,
        title:       true,
        depth:       true,
        createdById: true,
        parentId:    true,
        workspaceId: true,
        project: {
          include: {
            workspace: { include: { members: { select: { role: true, userId: true } } } },
            members:   { select: { role: true, userId: true } },
          },
        },
      },
    });

    if (!subtask) return { canEdit: false, reason: 'Subtask not found' };

    const isCreator        = subtask.createdById === userId;
    const projectMember    = subtask.project?.members?.find((m) => m.userId === userId);
    const isProjectManager = projectMember?.role === 'MANAGER';
    const workspaceMember  = subtask.project?.workspace?.members?.find((m) => m.userId === userId);
    const isWorkspaceAdmin = workspaceMember?.role === 'OWNER' || workspaceMember?.role === 'ADMIN';
    const canEdit          = isCreator || isProjectManager || isWorkspaceAdmin;

    if (!canEdit) {
      return {
        canEdit: false,
        reason:  'Only the subtask creator, project managers, or workspace admins can edit this subtask',
      };
    }

    return { canEdit: true, subtask };
  },

  async assertDeletePermission(subtaskId: string, userId: string) {
    const subtask = await prisma.task.findFirst({
      where: {
        id:    subtaskId,
        depth: 1,
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

    if (!subtask) throw new ForbiddenError('You do not have permission to delete this subtask');
    return subtask;
  },
};