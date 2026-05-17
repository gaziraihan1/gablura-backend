import {
  notifyUsers,
  notifyTaskAssignees,
  notifyMentions,
} from '../notification/index.js';
import { prisma } from '../../lib/prisma.js';
import type { NotificationType } from '@prisma/client';

export const TaskNotifications = {
  async notifyNewAssignees(params: {
    taskId:      string;
    taskTitle:   string;
    assigneeIds: string[];
    creatorId:   string;
  }): Promise<void> {
    try {
      const targets = params.assigneeIds.filter((id) => id !== params.creatorId);
      if (targets.length === 0) return;

      const creator = await prisma.user.findUnique({
        where:  { id: params.creatorId },
        select: { name: true },
      });

      // ✅ 1 INSERT for all assignees (was N serial inserts in a for-loop)
      await notifyUsers(
        targets.map((userId) => ({
          userId,
          senderId:  params.creatorId,
          type:      'TASK_ASSIGNED' as NotificationType,
          title:     'New Task Assigned',
          message:   `${creator?.name ?? 'Someone'} assigned you a task`,
          actionUrl: `/dashboard/tasks/${params.taskId}`,
        })),
      );
    } catch (error) {
      console.error('Failed to notify new assignees:', error);
    }
  },

  async notifyAddedAssignees(params: {
    taskId:    string;
    taskTitle: string;
    addedIds:  string[];
    updaterId: string;
  }): Promise<void> {
    try {
      const targets = params.addedIds.filter((id) => id !== params.updaterId);
      if (targets.length === 0) return;

      const updater = await prisma.user.findUnique({
        where:  { id: params.updaterId },
        select: { name: true },
      });

      // ✅ 1 INSERT for all added assignees (was N serial inserts in a for-loop)
      await notifyUsers(
        targets.map((userId) => ({
          userId,
          senderId:  params.updaterId,
          type:      'TASK_ASSIGNED' as NotificationType,
          title:     'Task Assigned',
          message:   `${updater?.name ?? 'Someone'} assigned you to "${params.taskTitle}"`,
          actionUrl: `/dashboard/tasks/${params.taskId}`,
        })),
      );
    } catch (error) {
      console.error('Failed to notify added assignees:', error);
    }
  },

  async notifyTaskCompleted(params: {
    taskId:    string;
    taskTitle: string;
    userId:    string;
  }): Promise<void> {
    try {
      notifyTaskAssignees({
        taskId:        params.taskId,
        senderId:      params.userId,
        type:          'TASK_COMPLETED',
        title:         'Task Completed',
        message:       `Task "${params.taskTitle}" was completed`,
        excludeUserId: params.userId,
      }).catch(() => {});
    } catch (error) {
      console.error('Failed to notify task completion:', error);
    }
  },

  async notifyNewComment(params: {
    taskId:        string;
    taskTitle:     string;
    commenterId:   string;
    commenterName: string;
  }): Promise<void> {
    try {
      notifyTaskAssignees({
        taskId:        params.taskId,
        senderId:      params.commenterId,
        type:          'TASK_COMMENTED',
        title:         'New Comment',
        message:       `${params.commenterName} commented on "${params.taskTitle}"`,
        excludeUserId: params.commenterId,
      }).catch(() => {});
    } catch (error) {
      console.error('Failed to notify new comment:', error);
    }
  },

  async notifyCommentMentions(params: {
    taskId:      string;
    taskTitle:   string;
    commentText: string;
    workspaceId: string;
    senderId:    string;
    senderName:  string;
  }): Promise<void> {
    try {
      notifyMentions({
        text:        params.commentText,
        workspaceId: params.workspaceId,
        senderId:    params.senderId,
        senderName:  params.senderName,
        context:     `task "${params.taskTitle}"`,
        actionUrl:   `/dashboard/tasks/${params.taskId}`,
      }).catch(() => {});
    } catch (error) {
      console.error('Failed to notify comment mentions:', error);
    }
  },
};