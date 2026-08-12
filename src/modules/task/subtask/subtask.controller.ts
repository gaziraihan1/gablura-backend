import type { Response }   from 'express';
import type { AuthRequest } from '../../../middleware/auth.js';
import { SubtaskQuery }    from './subtask.query.js';
import { SubtaskMutation } from './subtask.mutation.js';
import { SubtaskActivity } from './subtask.activity.js';
import { notifyUser }      from '../../notification/index.js';
import { TaskNotifications } from '../task.notifications.js';
import { asyncHandler, ValidationError } from '../../../errors/index.js';
import {
  createSubtaskSchema,
  updateSubtaskSchema,
  updateSubtaskStatusSchema,
} from './subtask.validators.js';

export const getSubtasks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const subtasks = await SubtaskQuery.getSubtasks(req.params.taskId, req.user!.id);
  res.json({ success: true, data: subtasks });
});

export const getSubtaskStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const stats = await SubtaskQuery.getSubtaskStats(req.params.taskId, req.user!.id);
  res.json({ success: true, data: stats });
});

export const getSubtask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const subtask = await SubtaskQuery.getSubtaskById(req.params.subtaskId, req.user!.id);
  res.json({ success: true, data: subtask });
});

export const createSubtask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createSubtaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const subtask = await SubtaskMutation.createSubtask(
    { ...parsed.data, parentId: req.params.taskId, createdById: req.user!.id },
    async ({ subtask, parentTaskId, workspaceId, assigneeIds }) => {
      if (workspaceId) {
        void SubtaskActivity.logCreated({
          subtaskId:    subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId,
          userId:       req.user!.id,
          workspaceId,
          workspaceSlug: subtask.workspace?.slug ?? 'unknown',
        });
      }
      if (assigneeIds.length > 0) {
        const creatorName = req.user!.name ?? 'Someone';
        for (const userId of assigneeIds) {
          if (userId === req.user!.id) continue;
          void notifyUser({
            userId,
            senderId:  req.user!.id,
            type:      'TASK_ASSIGNED',
            title:     'Subtask Assigned',
            message:   `${creatorName} assigned you to "${subtask.title}"`,
            actionUrl: `/dashboard/tasks/${parentTaskId}`,
          });
        }
      }

      // Keep the parent task's creator + assignees in the loop when a new
      // subtask lands (skip the person who created it).
      void TaskNotifications.notifySubtaskCreated({
        parentTaskId,
        subtaskTitle: subtask.title,
        creatorId:    req.user!.id,
      });
    },
  );

  res.status(201).json({ success: true, message: 'Subtask created successfully', data: subtask });
});

export const updateSubtask = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateSubtaskSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const subtask = await SubtaskMutation.updateSubtask(
    req.params.subtaskId, req.user!.id, parsed.data,
    async ({ subtask, parentTaskId, workspaceId, oldStatus, newStatus, changes }) => {
      if (!workspaceId) return;

      if (newStatus && oldStatus && newStatus !== oldStatus) {
        void SubtaskActivity.logStatusChanged({
          subtaskId:    subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId,
          userId:       req.user!.id,
          workspaceId,
          workspaceSlug: subtask.workspaceSlug,
          oldStatus,
          newStatus,
        });
      } else {
        void SubtaskActivity.logUpdated({
          subtaskId:    subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId,
          userId:       req.user!.id,
          workspaceId,
          workspaceSlug: subtask.workspace?.slug ?? 'unknown',
          changes,
        });
      }
    },
  );

  res.json({ success: true, message: 'Subtask updated successfully', data: subtask });
});

export const updateSubtaskStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = updateSubtaskStatusSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError('Validation error', parsed.error.issues);

  const subtask = await SubtaskMutation.updateSubtaskStatus(
    req.params.subtaskId, req.user!.id, parsed.data.status,
    async ({ subtask, parentTaskId, workspaceId, oldStatus, newStatus }) => {
      if (workspaceId && newStatus && oldStatus && newStatus !== oldStatus) {
        void SubtaskActivity.logStatusChanged({
          subtaskId:    subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId,
          userId:       req.user!.id,
          workspaceId,
          workspaceSlug: subtask.workspace?.slug ?? 'unknown',
          oldStatus,
          newStatus,
        });
      }
    },
  );

  res.json({ success: true, data: subtask });
});

export const deleteSubtask = asyncHandler(async (req: AuthRequest, res: Response) => {
  await SubtaskMutation.deleteSubtask(
    req.params.subtaskId, req.user!.id,
    async ({ subtask, parentTaskId, workspaceId }) => {
      if (workspaceId) {
        void SubtaskActivity.logDeleted({
          subtaskId:    subtask.id,
          subtaskTitle: subtask.title,
          parentTaskId,
          userId:       req.user!.id,
          workspaceId,
          workspaceSlug: subtask.workspace?.slug ?? 'unknown',
        });
      }
    },
  );

  res.json({ success: true, message: 'Subtask deleted successfully' });
});