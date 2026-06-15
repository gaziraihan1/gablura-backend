import type { Response }   from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { TaskQuery }         from './task.query.js';
import { TaskMutation }      from './task.mutation.js';
import { TaskActivity }      from './task.activity.js';
import { TaskNotifications } from './task.notifications.js';
import { CalendarAggregation } from '../calendar/calendar.aggregation.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';
import {
  getPersonalQuotaInfo,
  getWorkspaceQuotaInfo,
} from './task.limits.js';
import {
  getTasksQuerySchema,
  getTaskStatsQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from './task.validators.js';
import { prisma } from '../../lib/prisma.js';

export const getTasks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const { labelIds: rawLabelIds, ...rest } = parsed.data;
  const labelIds = rawLabelIds ? rawLabelIds.split(',').filter(Boolean) : undefined;

  const result = await TaskQuery.getTasks(
    { userId: req.user!.id, ...rest, labelIds },
    { page: parsed.data.page, pageSize: parsed.data.pageSize },
    { sortBy: parsed.data.sortBy, sortOrder: parsed.data.sortOrder },
  );

  res.json({ success: true, data: result.data, pagination: result.pagination });
});

export const getTaskStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = getTaskStatsQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const stats = await TaskQuery.getTaskStats({ userId: req.user!.id, ...parsed.data });
  res.json({ success: true, data: stats });
});

export const getTaskOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
  const overview = await TaskQuery.getTaskOverview(req.params.id, req.user!.id);
  res.json({ success: true, data: overview });
});

export const createTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validate before submitting (filled the form)', parsed.error.issues);

  const data = parsed.data;
  const task = await TaskMutation.createTask(
    { ...data, createdById: req.user!.id },
    async ({ task, assigneeIds }) => {
      if (task.workspaceId) {
        void TaskActivity.logCreated({
          taskId:        task.id,
          taskTitle:     task.title,
          userId:        req.user!.id,
          workspaceId:   task.workspaceId,
          focusRequired: data.focusRequired,
          energyType:    data.energyType,
          intent:        data.intent,
        });
      }
      if (assigneeIds.length > 0) {
        void TaskNotifications.notifyNewAssignees({
          taskId:      task.id,
          taskTitle:   task.title,
          assigneeIds,
          creatorId:   req.user!.id,
        });
      }
      if (task.dueDate) {
        void CalendarAggregation.recalculateDay(req.user!.id, task.workspaceId || undefined, task.dueDate);
      }
    },
  );

  res.status(201).json({ success: true, message: 'Task created successfully', data: task });
});

export const getTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const task = await TaskQuery.getTaskById(req.params.id, req.user!.id);
  res.json({ success: true, data: task });
});

export const updateTask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  // ✅ Remove this — it blocks admins before permission check even runs
  // const oldTask = await TaskQuery.getTaskById(req.params.id, req.user!.id);

  // ✅ Fetch old task without ownership restriction (only needed for dueDate diff)
  const oldTask = await prisma.task.findUnique({
    where:  { id: req.params.id },
    select: { dueDate: true },
  });

  const task = await TaskMutation.updateTask(
    req.params.id, req.user!.id, parsed.data,
    async ({ task, oldStatus, newStatus, addedAssigneeIds }) => {
      // ... rest of callback unchanged
      const dates = new Set<Date>();
      if (oldTask?.dueDate) dates.add(oldTask.dueDate);  // ✅ optional chain since oldTask may be null
      if (task.dueDate)     dates.add(task.dueDate);
      for (const date of dates) {
        void CalendarAggregation.recalculateDay(req.user!.id, task.workspaceId || undefined, date);
      }
    },
  );

  res.json({ success: true, message: 'Task updated successfully', data: task });
});

export const updateTaskStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateTaskStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const task = await TaskMutation.updateTaskStatus(
    req.params.id, req.user!.id, parsed.data.status,
    async ({ task, oldStatus, newStatus }) => {
      if (task.workspaceId && newStatus && oldStatus && newStatus !== oldStatus) {
        void TaskActivity.logStatusChanged({
          taskId: task.id, taskTitle: task.title, userId: req.user!.id,
          workspaceId: task.workspaceId, oldStatus, newStatus,
        });
      }
      if (newStatus === 'COMPLETED' && oldStatus !== 'COMPLETED') {
        void TaskNotifications.notifyTaskCompleted({ taskId: task.id, taskTitle: task.title, userId: req.user!.id });
      }
    },
  );

  res.json({ success: true, data: task });
});

export const deleteTask = asyncHandler(async (req: AuthRequest, res: Response) => {

  await TaskMutation.deleteTask(
    req.params.id, req.user!.id,
    async ({ task: deletedTask }) => {
      if (deletedTask.project?.workspaceId) {
        void TaskActivity.logDeleted({
          taskId:      deletedTask.id,
          taskTitle:   deletedTask.title,
          userId:      req.user!.id,
          workspaceId: deletedTask.project.workspaceId,
          status:      deletedTask.status,
          priority:    deletedTask.priority,
        });
      }
      if (deletedTask.dueDate) {  // ✅ use deletedTask (was task) for dueDate
        void CalendarAggregation.recalculateDay(
          req.user!.id,
          deletedTask.workspaceId || undefined,
          deletedTask.dueDate,
        );
      }
    },
  );

  res.json({ success: true, message: 'Task deleted successfully' });
});
export const getPersonalQuota = asyncHandler(async (req: AuthRequest, res: Response) => {
  const info = await getPersonalQuotaInfo(req.user!.id);
  res.json({ success: true, data: info });
});

export const getWorkspaceQuota = asyncHandler(async (req: AuthRequest, res: Response) => {
  const info = await getWorkspaceQuotaInfo(req.params.workspaceId, req.user!.id);
  res.json({ success: true, data: info });
});