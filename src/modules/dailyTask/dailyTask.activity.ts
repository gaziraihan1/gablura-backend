
import { prisma } from '../../lib/prisma.js';
import type { DailyTaskType } from './dailyTask.types.js';

export const DailyTaskActivity = {
  async logAdded(params: {
    userId: string;
    taskId: string;
    taskTitle: string;
    workspaceId: string;
    workspaceSlug?: string;
    type: DailyTaskType;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'UPDATED',
          entityType:  'TASK',
          entityId:    params.taskId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug || "",
          taskId:      params.taskId,
          metadata: {
            taskTitle:      params.taskTitle,
            dailyTaskType:  params.type,
            action:         'added_to_daily_tasks',
          },
        },
      });
    } catch (error) {
      console.error('Failed to log daily task add activity:', error);
    }
  },

  async logRemoved(params: {
    userId: string;
    taskId: string;
    taskTitle: string;
    workspaceId: string;
    workspaceSlug?: string;
    type: DailyTaskType;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'UPDATED',
          entityType:  'TASK',
          entityId:    params.taskId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: "",
          taskId:      params.taskId,
          metadata: {
            taskTitle:      params.taskTitle,
            dailyTaskType:  params.type,
            action:         'removed_from_daily_tasks',
          },
        },
      });
    } catch (error) {
      console.error('Failed to log daily task remove activity:', error);
    }
  },
};