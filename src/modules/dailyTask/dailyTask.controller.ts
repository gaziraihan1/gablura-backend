import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { DailyTaskQuery }    from './dailyTask.query.js';
import { DailyTaskMutation } from './dailyTask.mutation.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  getDailyTasksSchema,
  addDailyTaskSchema,
  removeDailyTaskSchema,
  dailyTaskStatsSchema,
} from './dailyTask.validators.js';

export const getDailyTasks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getDailyTasksSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const targetDate = parsed.data.date ?? new Date();
  const result     = await DailyTaskQuery.getDailyTasks({ userId: req.user!.id, date: targetDate });

  res.json({
    success: true,
    data: {
      date:           targetDate,
      primaryTask:    result.primaryTask?.task   ?? null,
      secondaryTasks: result.secondaryTasks.map((dt) => dt.task),
    },
  });
});

export const addDailyTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = addDailyTaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { taskId, type, date } = parsed.data;
  const targetDate = date ?? new Date();

  const dailyTask = await DailyTaskMutation.addDailyTask({
    userId: req.user!.id,
    taskId,
    type,
    date: targetDate,
  });

  res.status(201).json({
    success: true,
    message: `Task added to ${type.toLowerCase()} tasks`,
    data:    dailyTask,
  });
});

export const removeDailyTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = removeDailyTaskSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const targetDate = parsed.data.date ?? new Date();

  await DailyTaskMutation.removeDailyTask({
    userId: req.user!.id,
    taskId: req.params.taskId,
    date:   targetDate,
  });

  res.json({ success: true, message: 'Daily task removed successfully' });
});

export const clearExpiredDailyTasks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await DailyTaskMutation.clearExpiredDailyTasks();
  res.json({
    success: true,
    message: `Cleared ${result.deletedCount} expired daily tasks`,
    data:    result,
  });
});

export const getDailyTaskStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = dailyTaskStatsSchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const end   = parsed.data.endDate   ?? new Date();
  const start = parsed.data.startDate ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

  const stats = await DailyTaskQuery.getDailyTaskStats({
    userId:    req.user!.id,
    startDate: start,
    endDate:   end,
  });

  res.json({ success: true, data: { ...stats, startDate: start, endDate: end } });
});