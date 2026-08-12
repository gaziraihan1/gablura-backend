import {
  notifyUsers,
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
    userId:    string; // who completed it
  }): Promise<void> {
    try {
      const task = await prisma.task.findUnique({
        where: { id: params.taskId },
        select: {
          createdById: true,
          assignees: { select: { userId: true } },
        },
      });
      if (!task) return;

      // Everyone who should know the task is done: the creator AND all
      // assignees (excluding the person who completed it), limited to users
      // who have notifications enabled.
      const targets = new Set<string>([task.createdById]);
      for (const a of task.assignees) targets.add(a.userId);
      targets.delete(params.userId);
      if (targets.size === 0) return;

      const recipients = await prisma.user.findMany({
        where: { id: { in: Array.from(targets) }, notifications: true },
        select: { id: true },
      });
      const recipientIds = recipients.map((u) => u.id);
      if (recipientIds.length === 0) return;

      await notifyUsers(
        recipientIds.map((userId) => ({
          userId,
          senderId:  params.userId,
          type:      'TASK_COMPLETED' as NotificationType,
          title:     'Task Completed',
          message:   `Task "${params.taskTitle}" was completed`,
          actionUrl: `/dashboard/tasks/${params.taskId}`,
        })),
      );
    } catch (error) {
      console.error('Failed to notify task completion:', error);
    }
  },

  /**
   * Notify a subtask's parent-task stakeholders (creator + assignees) that a
   * new subtask was created, so the parent's people stay in the loop. The
   * subtask's own assignee is notified separately by the controller.
   */
  async notifySubtaskCreated(params: {
    parentTaskId: string;
    subtaskTitle: string;
    creatorId:    string;
  }): Promise<void> {
    try {
      const task = await prisma.task.findUnique({
        where: { id: params.parentTaskId },
        select: {
          title:       true,
          createdById: true,
          assignees: { select: { userId: true } },
        },
      });
      if (!task) return;

      const targets = new Set<string>([task.createdById]);
      for (const a of task.assignees) targets.add(a.userId);
      targets.delete(params.creatorId);
      if (targets.size === 0) return;

      const recipients = await prisma.user.findMany({
        where: { id: { in: Array.from(targets) }, notifications: true },
        select: { id: true },
      });
      const recipientIds = recipients.map((u) => u.id);
      if (recipientIds.length === 0) return;

      await notifyUsers(
        recipientIds.map((userId) => ({
          userId,
          senderId:  params.creatorId,
          type:      'TASK_COMMENTED' as NotificationType,
          title:     'New Subtask',
          message:   `A subtask "${params.subtaskTitle}" was added to "${task.title}"`,
          actionUrl: `/dashboard/tasks/${params.parentTaskId}`,
        })),
      );
    } catch (error) {
      console.error('Failed to notify parent task of new subtask:', error);
    }
  },
};
