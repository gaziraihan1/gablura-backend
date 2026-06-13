import { prisma }          from '../../../lib/prisma.js';
import type { CreateSubtaskInput, UpdateSubtaskInput } from './subtask.types.js';
import { SubtaskAccess }   from './subtask.access.js';
import { getTimeStatus }   from '../index.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../../errors/index.js';

const subtaskInclude = {
  createdBy: { select: { id: true, name: true, email: true, image: true } },
  assignees: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
  _count:    { select: { comments: true, files: true } },
} as const;

type OnSubtaskCreated = (data: {
  subtask:      any;
  parentTaskId: string;
  workspaceId?: string;
  assigneeIds:  string[];
}) => Promise<void>;

type OnSubtaskUpdated = (data: {
  subtask:      any;
  parentTaskId: string;
  workspaceId?: string;
  oldStatus?:   string;
  newStatus?:   string;
  changes:      Record<string, any>;
}) => Promise<void>;

type OnSubtaskDeleted = (data: {
  subtask:      any;
  parentTaskId: string;
  workspaceId?: string;
}) => Promise<void>;

export const SubtaskMutation = {
  async createSubtask(data: CreateSubtaskInput, onCreated?: OnSubtaskCreated) {
    if (!data.title?.trim()) throw new BadRequestError('Subtask title is required');

    const parent = await SubtaskAccess.assertCanCreateSubtask(data.parentId, data.createdById);

    if (parent.depth >= 1) throw new BadRequestError('Cannot create subtasks on a subtask');

    const subtask = await prisma.task.create({
      data: {
        title:          data.title,
        description:    data.description,
        status:         (data.status   as any) ?? 'TODO',
        priority:       (data.priority as any) ?? 'MEDIUM',
        dueDate:        data.dueDate ?? null,
        estimatedHours: data.estimatedHours,
        depth:          1,
        parentId:       data.parentId,
        createdById:    data.createdById,
        workspaceId:    parent.workspaceId,
        projectId:      parent.projectId,
        ...(data.assigneeIds?.length && {
          assignees: { create: data.assigneeIds.map((userId) => ({ userId })) },
        }),
      },
      include: subtaskInclude,
    });

    console.log(`✨ Subtask created: "${subtask.title}" under parent ${data.parentId}`);

    if (onCreated) {
      onCreated({
        subtask,
        parentTaskId: data.parentId,
        workspaceId:  parent.workspaceId ?? undefined,
        assigneeIds:  data.assigneeIds ?? [],
      }).catch((err) => console.error('Post-subtask-creation callback failed:', err));
    }

    return { ...subtask, timeTracking: getTimeStatus(subtask) };
  },

  async updateSubtask(subtaskId: string, userId: string, data: UpdateSubtaskInput, onUpdated?: OnSubtaskUpdated) {
    const permission = await SubtaskAccess.checkEditPermission(subtaskId, userId);
    if (!permission.canEdit) {
      throw new ForbiddenError(permission.reason || 'Cannot edit this subtask');
    }

    const existing = await prisma.task.findUnique({
      where:  { id: subtaskId },
      select: { status: true, parentId: true, workspaceId: true },
    });
    if (!existing) throw new NotFoundError('Subtask');

    const wasCompleted = data.status === 'COMPLETED' && existing.status !== 'COMPLETED';

    const updateData: any = {};
    if (data.title          !== undefined) updateData.title          = data.title;
    if (data.description    !== undefined) updateData.description    = data.description;
    if (data.status         !== undefined) updateData.status         = data.status as any;
    if (data.priority       !== undefined) updateData.priority       = data.priority as any;
    if (data.dueDate        !== undefined) updateData.dueDate        = data.dueDate;
    if (data.estimatedHours !== undefined) updateData.estimatedHours = data.estimatedHours;
    if (wasCompleted)                      updateData.completedAt    = new Date();

    const subtask = await prisma.task.update({
      where:   { id: subtaskId },
      data:    updateData,
      include: subtaskInclude,
    });

    console.log(`✏️  Subtask updated: "${subtask.title}" (ID: ${subtask.id})`);

    if (onUpdated) {
      onUpdated({
        subtask,
        parentTaskId: existing.parentId!,
        workspaceId:  existing.workspaceId ?? undefined,
        oldStatus:    data.status ? existing.status : undefined,
        newStatus:    data.status,
        changes:      data,
      }).catch((err) => console.error('Post-subtask-update callback failed:', err));
    }

    return { ...subtask, timeTracking: getTimeStatus(subtask) };
  },

  async updateSubtaskStatus(subtaskId: string, userId: string, status: string, onUpdated?: OnSubtaskUpdated) {
    if (!status) throw new BadRequestError('Status is required');

    const subtask = await prisma.task.findFirst({
      where: {
        id:    subtaskId,
        depth: 1,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          {
            project: {
              workspace: {
                members: { some: { userId, role: { in: ['OWNER', 'ADMIN'] } } },
              },
            },
          },
        ],
      },
      select: { status: true, parentId: true, workspaceId: true, title: true },
    });

    if (!subtask) throw new ForbiddenError('You do not have permission to change this subtask status');

    const wasCompleted = status === 'COMPLETED' && subtask.status !== 'COMPLETED';

    const updated = await prisma.task.update({
      where:   { id: subtaskId },
      data:    { status: status as any, ...(wasCompleted && { completedAt: new Date() }) },
      include: subtaskInclude,
    });

    console.log(`🔄 Subtask status updated: "${subtask.title}" → ${status}`);

    if (onUpdated) {
      onUpdated({
        subtask:      updated,
        parentTaskId: subtask.parentId!,
        workspaceId:  subtask.workspaceId ?? undefined,
        oldStatus:    subtask.status,
        newStatus:    status,
        changes:      { status },
      }).catch((err) => console.error('Post-subtask-status-update callback failed:', err));
    }

    return { ...updated, timeTracking: getTimeStatus(updated) };
  },

  async deleteSubtask(subtaskId: string, userId: string, onDeleted?: OnSubtaskDeleted) {
    const subtask = await SubtaskAccess.assertDeletePermission(subtaskId, userId);

    const full = await prisma.task.findUnique({
      where:  { id: subtaskId },
      select: { title: true, parentId: true, workspaceId: true, status: true, priority: true },
    });

    await prisma.task.delete({ where: { id: subtaskId } });

    console.log(`🗑️  Subtask deleted: "${full?.title}" (ID: ${subtaskId})`);

    if (onDeleted && full) {
      onDeleted({
        subtask:      { ...subtask, ...full },
        parentTaskId: full.parentId!,
        workspaceId:  full.workspaceId ?? undefined,
      }).catch((err) => console.error('Post-subtask-deletion callback failed:', err));
    }

    return { success: true };
  },
};