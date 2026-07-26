import { prisma }          from '../../lib/prisma.js';
import type { CreateTaskInput, UpdateTaskInput } from './task.types.js';
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

// ─── Callback types ───────────────────────────────────────────────────────────

type OnTaskCreated  = (data: { task: any; assigneeIds: string[] }) => Promise<void>;
type OnTaskUpdated  = (data: { task: any; oldStatus?: string; newStatus?: string; addedAssigneeIds: string[] }) => Promise<void>;
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

    let quotaConsumed: 'personal' | 'workspace' | null = null;

    if (finalWorkspaceId) {
      const [plan, memberCount] = await Promise.all([
        resolveWorkspacePlan(finalWorkspaceId),
        prisma.workspaceMember.count({ where: { workspaceId: finalWorkspaceId } }),
      ]);

      const quota = await checkAndConsumeWorkspaceQuota(
        data.createdById, finalWorkspaceId, plan, memberCount,
      );
      if (!quota.allowed) throw new BadRequestError(quota.reason ?? 'Workspace task creation limit reached');
      quotaConsumed = 'workspace';
    } else {
      const plan  = await resolveUserPlan(data.createdById);
      const quota = await checkAndConsumePersonalQuota(data.createdById, plan);
      if (!quota.allowed) throw new BadRequestError(quota.reason ?? 'Daily personal task creation limit reached');
      quotaConsumed = 'personal';
    }

    let computedPriority = data.priority ?? 'MEDIUM';
    if (!data.priority && data.dueDate) {
      const hoursLeft = (new Date(data.dueDate).getTime() - Date.now()) / 36e5;
      if (hoursLeft <= 24) computedPriority = 'HIGH';
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
      createdBy:       { connect: { id: data.createdById } },
    };

    if (data.projectId)      taskData.project   = { connect: { id: data.projectId } };
    if (finalWorkspaceId)    taskData.workspace  = { connect: { id: finalWorkspaceId } };
    if (data.parentId)       taskData.parent     = { connect: { id: data.parentId } };
    if (data.assigneeIds?.length) {
      taskData.assignees = { create: data.assigneeIds.map((userId) => ({ userId })) };
    }
    if (data.labelIds?.length) {
      taskData.labels = { create: data.labelIds.map((labelId) => ({ labelId })) };
    }

    let task: any;
    try {
      task = await prisma.task.create({ data: taskData, include: taskFullInclude });
    } catch (dbError) {
      if (quotaConsumed === 'personal') await rollbackPersonalQuota(data.createdById);
      else if (quotaConsumed === 'workspace' && finalWorkspaceId) {
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
      onCreated({ task, assigneeIds: data.assigneeIds || [] }).catch((err) =>
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

    const wasCompleted = data.status === 'COMPLETED' && existingTask.status !== 'COMPLETED';

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
    if (data.focusRequired !== undefined)  updateData.focusRequired  = data.focusRequired;
    if (data.focusLevel !== undefined)     updateData.focusLevel     = data.focusLevel;
    if (data.energyType !== undefined)     updateData.energyType     = data.energyType as any;
    if (data.distractionCost !== undefined) updateData.distractionCost = data.distractionCost;
    if (data.intent !== undefined)         updateData.intent         = data.intent as any;

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

    const task = await prisma.task.update({
      where:   { id: taskId },
      data:    updateData,
      include: taskFullInclude,
    });

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

    let addedAssigneeIds: string[] = [];
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

    const wasCompleted = status === 'COMPLETED' && existingTask.status !== 'COMPLETED';

    const updated = await prisma.task.update({
      where:   { id: taskId },
      data:    { status: status as any, ...(wasCompleted && { completedAt: new Date() }) },
      include: taskFullInclude,
    });

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