import { prisma } from '../../../lib/prisma.js';

export const SubtaskActivity = {
  async logCreated(params: {
    subtaskId:   string;
    subtaskTitle: string;
    parentTaskId: string;
    userId:      string;
    workspaceId: string;
    workspaceSlug: string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'CREATED',
          entityType:  'TASK',
          entityId:    params.subtaskId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug,
          taskId:      params.parentTaskId,
          metadata: {
            subtaskTitle: params.subtaskTitle,
            parentTaskId: params.parentTaskId,
            isSubtask:    true,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log subtask creation activity:', error);
    }
  },

  async logUpdated(params: {
    subtaskId:    string;
    subtaskTitle: string;
    parentTaskId: string;
    userId:       string;
    workspaceId:  string;
    workspaceSlug: string;
    changes:      Record<string, any>;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'UPDATED',
          entityType:  'TASK',
          entityId:    params.subtaskId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug,
          taskId:      params.parentTaskId,
          metadata: {
            subtaskTitle: params.subtaskTitle,
            parentTaskId: params.parentTaskId,
            isSubtask:    true,
            changes:      params.changes,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log subtask update activity:', error);
    }
  },

  async logStatusChanged(params: {
    subtaskId:    string;
    subtaskTitle: string;
    parentTaskId: string;
    userId:       string;
    workspaceId:  string;
    workspaceSlug: string;
    oldStatus:    string;
    newStatus:    string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'STATUS_CHANGED',
          entityType:  'TASK',
          entityId:    params.subtaskId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug,
          taskId:      params.parentTaskId,
          metadata: {
            subtaskTitle: params.subtaskTitle,
            parentTaskId: params.parentTaskId,
            isSubtask:    true,
            oldStatus:    params.oldStatus,
            newStatus:    params.newStatus,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log subtask status change activity:', error);
    }
  },

  async logDeleted(params: {
    subtaskId:    string;
    subtaskTitle: string;
    parentTaskId: string;
    userId:       string;
    workspaceId:  string;
    workspaceSlug: string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'DELETED',
          entityType:  'TASK',
          entityId:    params.subtaskId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug,
          taskId:      params.parentTaskId,
          metadata: {
            subtaskTitle: params.subtaskTitle,
            parentTaskId: params.parentTaskId,
            isSubtask:    true,
            deletedAt:    new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error('Failed to log subtask deletion activity:', error);
    }
  },
};