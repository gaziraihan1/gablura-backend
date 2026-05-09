import { prisma } from '../../../lib/prisma.js';
import type { EditSubtaskPermissionResult } from './subtask.types.js';

export const SubtaskAccess = {
  /**
   * Assert the user can VIEW subtasks on a parent task.
   * Same rule as TaskAccess.assertTaskAccess — must be creator, assignee,
   * or workspace member.
   */
  async assertParentTaskAccess(parentTaskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id:    parentTaskId,
        depth: 0,               // must be a root task, not itself a subtask
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { members: { some: { userId } } } },
          {
            project: {
              workspace: {
                OR: [
                  { ownerId: userId },
                  { members: { some: { userId, role: "ADMIN" } } },
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
        assignees: {
          select: { userId: true },
        },
      },
    });

    if (!task) {
      throw new Error('NOT_FOUND: Parent task not found or access denied');
    }

    return task;
  },

  /**
   * Assert the user is assigned to the parent task (required to CREATE a subtask).
   */
  async assertCanCreateSubtask(
    parentTaskId: string,
    userId: string,
  ) {
    const task = await this.assertParentTaskAccess(parentTaskId, userId);

    const isAssignee  = task.assignees.some((a) => a.userId === userId);
    const isCreator   = task.createdById === userId;

    if (!isAssignee && !isCreator) {
      throw new Error('FORBIDDEN: Only assignees or the task creator can create subtasks');
    }

    return task;
  },

  /**
   * Check edit permission on a subtask.
   * Only the subtask creator can edit it (matches your task ownership model).
   */
  async checkEditPermission(
    subtaskId: string,
    userId:    string,
  ): Promise<EditSubtaskPermissionResult & { subtask?: any }> {
    const subtask = await prisma.task.findFirst({
      where: { id: subtaskId, depth: 1 },
      select: {
        id:          true,
        title:       true,
        depth:       true,
        createdById: true,
        parentId:    true,
        workspaceId: true,
        project: {
          include: {
            workspace: {
              include: {
                members: { select: { role: true, userId: true } },
              },
            },
            members: { select: { role: true, userId: true } },
          },
        },
      },
    });

    if (!subtask) {
      return { canEdit: false, reason: 'Subtask not found' };
    }

    const isCreator        = subtask.createdById === userId;
    const projectMember    = subtask.project?.members?.find((m) => m.userId === userId);
    const isProjectManager = projectMember?.role === 'MANAGER';
    const workspaceMember  = subtask.project?.workspace?.members?.find((m) => m.userId === userId);
    const isWorkspaceAdmin = workspaceMember?.role === 'OWNER' || workspaceMember?.role === 'ADMIN';

    // Creator, project manager, or workspace admin can edit
    const canEdit = isCreator || isProjectManager || isWorkspaceAdmin;

    if (!canEdit) {
      return {
        canEdit: false,
        reason:  'Only the subtask creator, project managers, or workspace admins can edit this subtask',
      };
    }

    return { canEdit: true, subtask };
  },

  /**
   * Assert delete permission — same as edit but also allows workspace owner/admin.
   */
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
                members: {
                  some: { userId, role: { in: ['OWNER', 'ADMIN'] } },
                },
              },
            },
          },
        ],
      },
    });

    if (!subtask) {
      throw new Error('FORBIDDEN: You do not have permission to delete this subtask');
    }

    return subtask;
  },
};