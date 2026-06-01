import { prisma }                              from '../../lib/prisma.js';
import type { CreateLabelDto, UpdateLabelDto } from './label.types.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../errors/index.js';
import { labelListInclude, taskLabelInclude }  from './label.selects.js';
import { LabelAccess }                         from './label.access.js';
import { LabelCache }                          from '../../lib/redis/cache.client.js';

export const LabelMutation = {
  async createLabel(data: CreateLabelDto) {
    if (data.workspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where:  { id: data.workspaceId },
        select: { ownerId: true },
      });
      if (!workspace) throw new NotFoundError('Workspace');

      const isOwner = workspace.ownerId === data.createdById;
      if (!isOwner) {
        const admin = await prisma.workspaceMember.findFirst({
          where: { workspaceId: data.workspaceId, userId: data.createdById, role: 'ADMIN' },
        });
        if (!admin) throw new ForbiddenError('Only workspace owner or admins can create workspace labels');
      }
    }

    await LabelAccess.assertNoDuplicateName(data.name, data.workspaceId, data.createdById);

    const label = await prisma.label.create({
      data: {
        name:        data.name,
        color:       data.color,
        description: data.description,
        workspaceId: data.workspaceId,
        createdById: data.createdById,
      },
      include: labelListInclude,
    });

    await LabelCache.invalidateLabelList(data.createdById, data.workspaceId ?? null);
    return label;
  },

  async updateLabel(labelId: string, userId: string, data: UpdateLabelDto) {
    const existingLabel = await prisma.label.findUnique({
      where:   { id: labelId },
      include: { workspace: true },
    });
    if (!existingLabel) throw new NotFoundError('Label');

    const canManage = await LabelAccess.canManageLabel(existingLabel, userId);
    if (!canManage) throw new ForbiddenError('Only workspace owner or admins can edit workspace labels');

    if (data.name && data.name !== existingLabel.name) {
      await LabelAccess.assertNoDuplicateName(
        data.name,
        existingLabel.workspaceId,
        existingLabel.createdById,
        labelId,
      );
    }

    const updatedLabel = await prisma.label.update({
      where: { id: labelId },
      data: {
        ...(data.name        !== undefined && { name:        data.name        }),
        ...(data.color       !== undefined && { color:       data.color       }),
        ...(data.description !== undefined && { description: data.description }),
      },
      include: labelListInclude,
    });

    await LabelCache.invalidateLabel(labelId);
    await LabelCache.invalidateLabelList(existingLabel.createdById, existingLabel.workspaceId);
    return updatedLabel;
  },

  async deleteLabel(labelId: string, userId: string) {
    const label = await prisma.label.findUnique({
      where:   { id: labelId },
      include: { _count: { select: { tasks: true } }, workspace: true },
    });
    if (!label) throw new NotFoundError('Label');

    const canManage = await LabelAccess.canManageLabel(label, userId);
    if (!canManage) throw new ForbiddenError('Only workspace owner or admins can delete workspace labels');

    await prisma.label.delete({ where: { id: labelId } });
    await LabelCache.invalidateLabel(labelId);
    await LabelCache.invalidateLabelList(label.createdById, label.workspaceId);

    return { tasksAffected: label._count.tasks };
  },

  async addLabelToTask(labelId: string, taskId: string, userId: string) {
    await LabelAccess.assertTaskAccess(taskId, userId);

    const label = await prisma.label.findUnique({ where: { id: labelId } });
    if (!label) throw new NotFoundError('Label');

    const existing = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId, labelId } },
    });
    if (existing) throw new ConflictError('Label already added to task');

    return prisma.taskLabel.create({
      data:    { taskId, labelId },
      include: taskLabelInclude,
    });
  },

  async removeLabelFromTask(labelId: string, taskId: string, userId: string) {
    await LabelAccess.assertTaskAccess(taskId, userId);

    const taskLabel = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId, labelId } },
    });
    if (!taskLabel) throw new NotFoundError('Label on task');

    await prisma.taskLabel.delete({ where: { taskId_labelId: { taskId, labelId } } });
  },
};