import { prisma }          from '../../lib/prisma.js';
import type { CreateTaskInput, UpdateTaskInput, RecurrenceInput } from './task.types.js';
import { taskFullInclude } from './task.selects.js';
import { TaskAccess }      from './task.access.js';
import { getTimeStatus }   from './task.utils.js';
import {
  checkAndConsumePersonalQuota,
  checkAndConsumeWorkspaceQuota,
  rollbackPersonalQuota,
  rollbackWorkspaceQuota,
  resolveUserPlan,
  resolveWorkspacePlan,
} from './task.quota.service.js';
import { ProjectAccess }   from '../project/project.access.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors/index.js';
import { addInvalidateCacheJob } from '../../queue/index.js';
import { TaskCache, AccessControlCache } from '../../lib/redis/cache.client.js';

// ─── Callback types ───────────────────────────────────────────────────────────

type OnTaskCreated  = (data: { task: any; assigneeIds: string[]; labelIds: string[] }) => Promise<void>;
type OnTaskUpdated  = (data: {
  task: any;
  oldStatus?: string;
  newStatus?: string;
  addedAssigneeIds: string[];
  addedLabelIds: string[];
}) => Promise<void>;

/**
 * Refresh a task's live status onto the permission snapshot before computing
 * status transitions. checkEditPermission caches its result per (taskId,
 * userId), so `status` can lag a recent change made by another request.
 */
export async function refreshTaskStatus(
  taskId: string,
  existingTask: { status?: string },
): Promise<void> {
  const current = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });
  if (current) existingTask.status = current.status;
}

/**
 * Compute the completion/reopen transition between two statuses so callers can
 * set or clear `completedAt`. Both flags are false when `nextStatus` is absent.
 */
export function computeStatusTransition(
  previousStatus: string | undefined,
  nextStatus: string | undefined,
): { wasCompleted: boolean; wasReopened: boolean } {
  if (!nextStatus) return { wasCompleted: false, wasReopened: false };
  return {
    wasCompleted: nextStatus === 'COMPLETED' && previousStatus !== 'COMPLETED',
    wasReopened:  nextStatus !== 'COMPLETED' && previousStatus === 'COMPLETED',
  };
}
type OnTaskDeleted  = (data: { task: any }) => Promise<void>;
type OnCommentAdded = (data: { taskId: string; taskTitle: string; workspaceId?: string }) => Promise<void>;

// ─── Mutations ────────────────────────────────────────────────────────────────

export const TaskMutation = {
  async createTask(data: CreateTaskInput, onCreated?: OnTaskCreated) {
    if (!data.title?.trim())        throw new BadRequestError('Task title is required');
    if(data.title.length > 200) throw new BadRequestError('Task title cannot exceed 200 characters');
    if (data.focusLevel !== undefined && (data.focusLevel < 1 || data.focusLevel > 5)) {
      throw new BadRequestError('Focus level must be between 1 and 5');
    }
    if (data.distractionCost !== undefined && data.distractionCost < 0) {
      throw new BadRequestError('Distraction cost cannot be negative');
    }
    if(data.dueDate && data.startDate && new Date(data.startDate) > new Date(data.dueDate)) {
      throw new BadRequestError('Start date cannot be after due date');
    }
    // if(data.startDate === undefined) {
    //   throw new BadRequestError('Start date is required');
    // }
   
    // if(data.dueDate === undefined) {
    //   throw new BadRequestError('Due date is required');
    // }
    if (data.assigneeIds && data.assigneeIds.length > 5) {
      throw new BadRequestError('Too many assignees reduce task focus');
    }

    let finalWorkspaceId: string | null = null;

    if (data.projectId) {
      await ProjectAccess.assertProjectNotArchived(data.projectId);

      const project = await prisma.project.findFirst({
        where: {
          id: data.projectId,
          workspace: {
            OR: [
              { ownerId: data.createdById },
              { members: { some: { userId: data.createdById } } },
            ],
          },
        },
        select: { workspaceId: true },
      });
      if (!project) throw new ForbiddenError('You do not have access to this project');
      finalWorkspaceId = project.workspaceId;
    }

    if (finalWorkspaceId) {
      const [plan, memberCount] = await Promise.all([
        resolveWorkspacePlan(finalWorkspaceId),
        prisma.workspaceMember.count({ where: { workspaceId: finalWorkspaceId } }),
      ]);

      const quota = await checkAndConsumeWorkspaceQuota(
        data.createdById, finalWorkspaceId, plan, memberCount,
      );
      if (!quota.allowed) throw new BadRequestError(quota.reason ?? 'Workspace task creation limit reached');
    } else {
      const plan  = await resolveUserPlan(data.createdById);
      const quota = await checkAndConsumePersonalQuota(data.createdById, plan);
      if (!quota.allowed) throw new BadRequestError(quota.reason ?? 'Daily personal task creation limit reached');
    }

    let computedPriority = data.priority ?? 'MEDIUM';
    if (!data.priority && data.dueDate) {
      const hoursLeft = (new Date(data.dueDate).getTime() - Date.now()) / 36e5;
      if (hoursLeft <= 24) computedPriority = 'HIGH';
    }

    if (data.sectionId) {
      if (!data.projectId) throw new BadRequestError('Section requires a project');
      const section = await prisma.projectSection.findFirst({
        where: { id: data.sectionId, projectId: data.projectId },
        select: { id: true },
      });
      if (!section) throw new BadRequestError('Section does not belong to this project');
    }

    if (data.sprintId) {
      if (!data.projectId) throw new BadRequestError('Sprint requires a project');
      const sprint = await prisma.sprint.findFirst({
        where: { id: data.sprintId, projectId: data.projectId },
        select: { id: true },
      });
      if (!sprint) throw new BadRequestError('Sprint does not belong to this project');
    }

    if (data.milestoneId) {
      if (!data.projectId) throw new BadRequestError('Milestone requires a project');
      const milestone = await prisma.projectMilestone.findFirst({
        where: { id: data.milestoneId, projectId: data.projectId },
        select: { id: true },
      });
      if (!milestone) throw new BadRequestError('Milestone does not belong to this project');
    }

    const taskData: any = {
      title:           data.title,
      description:     data.description,
      status:          data.status || 'TODO',
      priority:        computedPriority as any,
      dueDate:         data.dueDate   ? new Date(data.dueDate)   : null,
      startDate:       data.startDate ? new Date(data.startDate) : null,
      estimatedHours:  data.estimatedHours,
      focusRequired:   data.focusRequired ?? false,
      focusLevel:      data.focusLevel,
      energyType:      data.energyType as any,
      distractionCost: data.distractionCost,
      intent:          data.intent as any,
      createdById:     data.createdById,
    };

    if (data.projectId)      taskData.projectId   = data.projectId;
    if (data.sectionId)      taskData.sectionId   = data.sectionId;
    if (data.sprintId)       taskData.sprintId    = data.sprintId;
    if (data.milestoneId)    taskData.milestoneId = data.milestoneId;
    if (finalWorkspaceId)    taskData.workspaceId  = finalWorkspaceId;
    if (data.parentId)       taskData.parentId     = data.parentId;
    if (data.assigneeIds?.length) {
      taskData.assignees = { create: data.assigneeIds.map((userId) => ({ userId })) };
    }
    if (data.labelIds?.length) {
      taskData.labels = { create: data.labelIds.map((labelId) => ({ labelId })) };
    }

    let task: any;
    try {
      if (data.recurrence) {
        const recurrence = data.recurrence;
        task = await prisma.$transaction(async (tx) => {
          const created = await tx.task.create({ data: taskData, include: taskFullInclude });
          const anchor = created.dueDate && created.dueDate.getTime() > Date.now()
            ? created.dueDate
            : new Date();
          const recurrenceRow = await tx.taskRecurrence.create({
            data: {
              taskId:         created.id,
              pattern:        recurrence.pattern,
              interval:       recurrence.interval ?? 1,
              days:           recurrence.days ?? undefined,
              endsAt:         recurrence.endsAt ?? null,
              lastOccurredAt: anchor,
            },
          });
          return { ...created, recurrence: recurrenceRow };
        });
      } else {
        task = await prisma.task.create({ data: taskData, include: taskFullInclude });
      }
    } catch (dbError) {
      if (!finalWorkspaceId) await rollbackPersonalQuota(data.createdById);
      else if (finalWorkspaceId) {
        await rollbackWorkspaceQuota(data.createdById, finalWorkspaceId);
      }
      throw dbError;
    }

    if (finalWorkspaceId) {
      addInvalidateCacheJob({ type: 'analytics', workspaceId: finalWorkspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'workspace', workspaceId: finalWorkspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'task', userId: data.createdById, workspaceId: finalWorkspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId: data.createdById, workspaceId: finalWorkspaceId }).catch(() => {});
    } else {
      addInvalidateCacheJob({ type: 'task', userId: data.createdById }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId: data.createdById }).catch(() => {});
    }

    if (onCreated) {
      onCreated({ task, assigneeIds: data.assigneeIds || [], labelIds: data.labelIds || [] }).catch((err) =>
        console.error('Post-creation callback failed:', err),
      );
    }

    return { ...task, timeTracking: getTimeStatus(task) };
  },

  async updateTask(taskId: string, userId: string, data: UpdateTaskInput, onUpdated?: OnTaskUpdated) {
    const permission = await TaskAccess.checkEditPermission(taskId, userId);
    if (!permission.canEdit) {
      throw new ForbiddenError(permission.reason || 'You do not have permission to edit this task');
    }

    // Reuse task data from permission check (avoids redundant DB query)
    const existingTask = permission.task!;
    if (existingTask.projectId) {
      await ProjectAccess.assertProjectNotArchived(existingTask.projectId);
    }

    if (data.status) {
      await refreshTaskStatus(taskId, existingTask);
    }

    const { wasCompleted, wasReopened } = computeStatusTransition(existingTask.status, data.status);

    const updateData: any = {};
    if (data.title)                     updateData.title           = data.title;
    if (data.description !== undefined) updateData.description     = data.description;
    if (data.projectId !== undefined)   updateData.projectId       = data.projectId;
    if (data.status)                    updateData.status          = data.status as any;
    if (data.priority)                  updateData.priority        = data.priority as any;
    if (data.dueDate !== undefined)     updateData.dueDate         = data.dueDate ? new Date(data.dueDate) : null;
    if (data.startDate !== undefined)   updateData.startDate       = data.startDate ? new Date(data.startDate) : null;
    if (data.estimatedHours !== undefined) updateData.estimatedHours = data.estimatedHours;
    if (wasCompleted)                   updateData.completedAt     = new Date();
    if (wasReopened)                    updateData.completedAt     = null;
    if (data.focusRequired !== undefined)  updateData.focusRequired  = data.focusRequired;
    if (data.focusLevel !== undefined)     updateData.focusLevel     = data.focusLevel;
    if (data.energyType !== undefined)     updateData.energyType     = data.energyType as any;
    if (data.distractionCost !== undefined) updateData.distractionCost = data.distractionCost;
    if (data.intent !== undefined)         updateData.intent         = data.intent as any;
    if (data.sectionId !== undefined)     updateData.sectionId   = data.sectionId ?? null;
    if (data.sprintId !== undefined)      updateData.sprintId    = data.sprintId ?? null;
    if (data.milestoneId !== undefined)   updateData.milestoneId = data.milestoneId ?? null;

    if (data.projectId && data.projectId !== existingTask.projectId) {
      const newProject = await prisma.project.findUnique({
        where: { id: data.projectId },
        select: { workspaceId: true },
      });
      if (!newProject) throw new NotFoundError('Project');

      const workspaceId = newProject.workspaceId;
      const [plan, memberCount] = await Promise.all([
        resolveWorkspacePlan(workspaceId!),
        prisma.workspaceMember.count({ where: { workspaceId } }),
      ]);

      const quota = await checkAndConsumeWorkspaceQuota(
        userId, workspaceId!, plan, memberCount,
      );
      if (!quota.allowed) throw new BadRequestError(quota.reason ?? 'Workspace task limit reached');
    }

    if (data.sectionId) {
      if (!existingTask.projectId) throw new BadRequestError('Section requires a project');
      const section = await prisma.projectSection.findFirst({
        where: { id: data.sectionId, projectId: existingTask.projectId },
        select: { id: true },
      });
      if (!section) throw new BadRequestError('Section does not belong to this task project');
    }
    if (data.sprintId) {
      if (!existingTask.projectId) throw new BadRequestError('Sprint requires a project');
      const sprint = await prisma.sprint.findFirst({
        where: { id: data.sprintId, projectId: existingTask.projectId },
        select: { id: true },
      });
      if (!sprint) throw new BadRequestError('Sprint does not belong to this task project');
    }
    if (data.milestoneId) {
      if (!existingTask.projectId) throw new BadRequestError('Milestone requires a project');
      const milestone = await prisma.projectMilestone.findFirst({
        where: { id: data.milestoneId, projectId: existingTask.projectId },
        select: { id: true },
      });
      if (!milestone) throw new BadRequestError('Milestone does not belong to this task project');
    }

    updateData.editedById = userId;
    const task = await prisma.task.update({
      where:   { id: taskId },
      data:    updateData,
      include: taskFullInclude,
    });

    // Clear the task's Redis cache synchronously so any immediate read
    // (e.g. the frontend refetch after this mutation) sees fresh data.
    // The background job still handles stats/list/analytics invalidation.
    await TaskCache.invalidateTask(taskId);
    await AccessControlCache.invalidateTaskEdit(taskId, userId);

    if (existingTask.workspaceId) {
      addInvalidateCacheJob({ type: 'analytics', workspaceId: existingTask.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'workspace', workspaceId: existingTask.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'task', taskId, userId, workspaceId: existingTask.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId, workspaceId: existingTask.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'access-control', taskId, workspaceId: existingTask.workspaceId }).catch(() => {});
    } else {
      addInvalidateCacheJob({ type: 'task', taskId, userId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId }).catch(() => {});
      addInvalidateCacheJob({ type: 'access-control', taskId }).catch(() => {});
    }

    // Recurrence changes (upsert or stop)
    if (data.recurrence !== undefined) {
      if (data.recurrence === null) {
        await prisma.taskRecurrence.deleteMany({ where: { taskId } });
        task.recurrence = null;
      } else {
        const rec = data.recurrence;
        const anchor = task.dueDate && task.dueDate.getTime() > Date.now()
          ? task.dueDate
          : new Date();
        const recurrenceRow = await prisma.taskRecurrence.upsert({
          where:  { taskId },
          create: {
            taskId, pattern: rec.pattern, interval: rec.interval ?? 1,
            days: rec.days ?? undefined, endsAt: rec.endsAt ?? null, lastOccurredAt: anchor,
          },
          update: {
            pattern: rec.pattern, interval: rec.interval ?? 1,
            days: rec.days ?? undefined, endsAt: rec.endsAt ?? null,
          },
        });
        task.recurrence = recurrenceRow;
      }
    }

    let addedAssigneeIds: string[] = [];
    let addedLabelIds: string[] = [];
    if (data.assigneeIds !== undefined || data.labelIds !== undefined) {
      // Atomic replacement of assignees and labels within a transaction
      await prisma.$transaction(async (tx) => {
        if (data.assigneeIds !== undefined) {
          const existingIds = existingTask.assignees.map((a: {userId: string}) => a.userId);
          addedAssigneeIds  = data.assigneeIds.filter((uid) => !existingIds.includes(uid));
          await tx.taskAssignee.deleteMany({ where: { taskId } });
          if (data.assigneeIds.length > 0) {
            await tx.taskAssignee.createMany({
              data: data.assigneeIds.map((userId) => ({ taskId, userId })),
            });
          }
        }

        if (data.labelIds !== undefined) {
          const existingLabelIds = (
            await tx.taskLabel.findMany({ where: { taskId }, select: { labelId: true } })
          ).map((l: { labelId: string }) => l.labelId);
          addedLabelIds = data.labelIds.filter((labelId) => !existingLabelIds.includes(labelId));
          await tx.taskLabel.deleteMany({ where: { taskId } });
          if (data.labelIds.length > 0) {
            await tx.taskLabel.createMany({
              data: data.labelIds.map((labelId) => ({ taskId, labelId })),
            });
          }
        }
      });
    }

    if (onUpdated) {
      onUpdated({
        task,
        oldStatus:        data.status ? existingTask.status : undefined,
        newStatus:        data.status,
        addedAssigneeIds,
        addedLabelIds,
      }).catch((err) => console.error('Post-update callback failed:', err));
    }

    return { ...task, timeTracking: getTimeStatus(task) };
  },

  async updateTaskStatus(taskId: string, userId: string, status: string, onUpdated?: OnTaskUpdated) {
    if (!status) throw new BadRequestError('Status is required');

    const permission = await TaskAccess.checkEditPermission(taskId, userId);
    if (!permission.canEdit) {
      throw new ForbiddenError(permission.reason || 'You do not have permission to change this task status');
    }

    // Reuse task data from permission check (avoids redundant DB query)
    const existingTask = permission.task!;
    if (existingTask.projectId) {
      await ProjectAccess.assertProjectNotArchived(existingTask.projectId);
    }

    await refreshTaskStatus(taskId, existingTask);

    const { wasCompleted, wasReopened } = computeStatusTransition(existingTask.status, status);

    const updated = await prisma.task.update({
      where:   { id: taskId },
      data:    {
        status: status as any,
        ...(wasCompleted && { completedAt: new Date() }),
        ...(wasReopened  && { completedAt: null }),
      },
      include: taskFullInclude,
    });

    // Clear the task's Redis cache synchronously so any immediate read
    // (e.g. the frontend refetch after this mutation) sees fresh data.
    // The background job still handles stats/list/analytics invalidation.
    await TaskCache.invalidateTask(taskId);
    await AccessControlCache.invalidateTaskEdit(taskId, userId);

    if (existingTask.workspaceId) {
      addInvalidateCacheJob({ type: 'analytics', workspaceId: existingTask.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'workspace', workspaceId: existingTask.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'task', taskId, userId, workspaceId: existingTask.workspaceId }).catch(() => {});
    } else {
      addInvalidateCacheJob({ type: 'task', taskId, userId }).catch(() => {});
    }

    if (onUpdated) {
      onUpdated({
        task:             updated,
        oldStatus:        existingTask.status,
        newStatus:        status,
        addedAssigneeIds: [],
        addedLabelIds:    [],
      }).catch((err) => console.error('Post-status-update callback failed:', err));
    }

    return { ...updated, timeTracking: getTimeStatus(updated) };
  },

  async deleteTask(taskId: string, userId: string, onDeleted?: OnTaskDeleted) {
    const task = await TaskAccess.assertDeletePermission(taskId, userId);
    if (task.projectId) await ProjectAccess.assertProjectNotArchived(task.projectId);

    const workspaceId = task.workspaceId;
    await prisma.task.delete({ where: { id: taskId } });

    if (workspaceId) {
      addInvalidateCacheJob({ type: 'analytics', workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'workspace', workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'task', taskId, userId, workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId, workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'access-control', taskId, workspaceId }).catch(() => {});
    } else {
      addInvalidateCacheJob({ type: 'task', taskId, userId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId }).catch(() => {});
      addInvalidateCacheJob({ type: 'access-control', taskId }).catch(() => {});
    }

    if (onDeleted) {
      onDeleted({ task }).catch((err) => console.error('Post-deletion callback failed:', err));
    }

    return { success: true };
  },

  async upsertRecurrence(taskId: string, userId: string, data: RecurrenceInput, onUpserted?: (data: { task: any; recurrence: any }) => Promise<void>) {
    const permission = await TaskAccess.checkEditPermission(taskId, userId);
    if (!permission.canEdit) {
      throw new ForbiddenError(permission.reason || 'You do not have permission to edit this task');
    }
    if (permission.task?.projectId) {
      await ProjectAccess.assertProjectNotArchived(permission.task.projectId);
    }

    const taskInfo = await prisma.task.findUnique({
      where:  { id: taskId },
      select: { id: true, title: true, workspaceId: true, dueDate: true },
    });

    const anchor = taskInfo?.dueDate && taskInfo.dueDate.getTime() > Date.now()
      ? taskInfo.dueDate
      : new Date();

    const recurrence = await prisma.taskRecurrence.upsert({
      where:  { taskId },
      create: {
        taskId, pattern: data.pattern, interval: data.interval ?? 1,
        days: data.days ?? undefined, endsAt: data.endsAt ?? null, lastOccurredAt: anchor,
      },
      update: {
        pattern: data.pattern, interval: data.interval ?? 1,
        days: data.days ?? undefined, endsAt: data.endsAt ?? null,
      },
    });

    if (taskInfo?.workspaceId) {
      addInvalidateCacheJob({ type: 'task', taskId, userId, workspaceId: taskInfo.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId, workspaceId: taskInfo.workspaceId }).catch(() => {});
    } else {
      addInvalidateCacheJob({ type: 'task', taskId, userId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId }).catch(() => {});
    }

    if (onUpserted) {
      onUpserted({ task: taskInfo, recurrence }).catch((err) =>
        console.error('Post-recurrence-upsert callback failed:', err),
      );
    }

    return recurrence;
  },

  async deleteRecurrence(taskId: string, userId: string, onDeleted?: (data: { task: any }) => Promise<void>) {
    const permission = await TaskAccess.checkEditPermission(taskId, userId);
    if (!permission.canEdit) {
      throw new ForbiddenError(permission.reason || 'You do not have permission to edit this task');
    }
    if (permission.task?.projectId) {
      await ProjectAccess.assertProjectNotArchived(permission.task.projectId);
    }

    const recurrence = await prisma.taskRecurrence.findUnique({ where: { taskId } });
    if (!recurrence) throw new NotFoundError('Recurrence not found for this task');

    await prisma.taskRecurrence.delete({ where: { taskId } });

    const taskInfo = await prisma.task.findUnique({
      where:  { id: taskId },
      select: { id: true, title: true, workspaceId: true },
    });
    if (taskInfo?.workspaceId) {
      addInvalidateCacheJob({ type: 'task', taskId, userId, workspaceId: taskInfo.workspaceId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId, workspaceId: taskInfo.workspaceId }).catch(() => {});
    } else {
      addInvalidateCacheJob({ type: 'task', taskId, userId }).catch(() => {});
      addInvalidateCacheJob({ type: 'calendar', userId }).catch(() => {});
    }

    if (onDeleted) {
      onDeleted({ task: taskInfo }).catch((err) =>
        console.error('Post-recurrence-delete callback failed:', err),
      );
    }

    return { success: true };
  },

  async addComment(taskId: string, userId: string, content: string, onCommentAdded?: OnCommentAdded) {
    const comment = await prisma.comment.create({
      data: { taskId, userId, content },
    });

    const task = await prisma.task.findUnique({
      where:   { id: taskId },
      include: { project: true },
    });

    if (onCommentAdded && task) {
      onCommentAdded({
        taskId,
        taskTitle:   task.title,
        workspaceId: task.project?.workspaceId ?? undefined,
      }).catch((err) => console.error('Post-comment callback failed:', err));
    }

    return comment;
  },
};