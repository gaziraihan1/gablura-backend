import { prisma }          from '../../lib/prisma.js';
import type { AddDailyTaskParams, RemoveDailyTaskParams, ClearExpiredResult } from './dailyTask.types.js';
import { taskFullInclude } from './dailyTask.selects.js';
import { DailyTaskAccess } from './dailyTask.access.js';
import { DailyTaskActivity } from './dailyTask.activity.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../errors/index.js';

function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export const DailyTaskMutation = {
  async addDailyTask(params: AddDailyTaskParams) {
    const date           = params.date ?? new Date();
    const { start, end } = dayBounds(date);

    const task = await DailyTaskAccess.assertTaskAccess(params.userId, params.taskId);

    if (task.status === 'COMPLETED') {
      throw new BadRequestError('Cannot add a completed task to daily tasks');
    }

    if (params.type === 'PRIMARY') {
      const existingPrimary = await prisma.dailyTask.findFirst({
        where: { userId: params.userId, type: 'PRIMARY', date: { gte: start, lt: end } },
      });
      if (existingPrimary) {
        throw new ConflictError(
          'You already have a primary task for today. Remove it first or choose secondary.',
          'PRIMARY_TASK_CONFLICT',
        );
      }
    }

    const existing = await prisma.dailyTask.findFirst({
      where: { userId: params.userId, taskId: params.taskId, date: { gte: start, lt: end } },
    });

    if (existing) {
      if (existing.type === params.type) return existing;
      return prisma.dailyTask.update({
        where:   { id: existing.id },
        data:    { type: params.type },
        include: { task: { include: taskFullInclude } },
      });
    }

    const dailyTask = await prisma.dailyTask.create({
      data:    { userId: params.userId, taskId: params.taskId, type: params.type, date: start },
      include: { task: { include: taskFullInclude } },
    });

    const workspaceId = task.project?.workspace?.id;
    if (workspaceId) {
      void DailyTaskActivity.logAdded({
        userId:      params.userId,
        taskId:      params.taskId,
        taskTitle:   task.title,
        workspaceId,
        type:        params.type,
      });
    }

    return dailyTask;
  },

  async removeDailyTask(params: RemoveDailyTaskParams) {
    const date           = params.date ?? new Date();
    const { start, end } = dayBounds(date);

    const dailyTask = await prisma.dailyTask.findFirst({
      where: { userId: params.userId, taskId: params.taskId, date: { gte: start, lt: end } },
      include: {
        task: { include: { project: { select: { workspace: { select: { id: true } } } } } },
      },
    });

    if (!dailyTask) throw new NotFoundError('Daily task');

    await prisma.dailyTask.delete({ where: { id: dailyTask.id } });

    const workspaceId = dailyTask.task.project?.workspace?.id;
    if (workspaceId) {
      void DailyTaskActivity.logRemoved({
        userId:      params.userId,
        taskId:      params.taskId,
        taskTitle:   dailyTask.task.title,
        workspaceId,
        type:        dailyTask.type as 'PRIMARY' | 'SECONDARY',
      });
    }
  },

  async clearExpiredDailyTasks(): Promise<ClearExpiredResult> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const result = await prisma.dailyTask.deleteMany({ where: { date: { lt: today } } });
    return { deletedCount: result.count };
  },
};