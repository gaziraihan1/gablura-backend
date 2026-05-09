import { prisma } from "../../lib/prisma.js";
import type { CreateLabelDto, UpdateLabelDto } from "./label.types.js";
import {
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from "./label.types.js";
import { labelListInclude, taskLabelInclude } from "./label.selects.js";
import { LabelAccess } from "./label.access.js";

export const LabelMutation = {
  async createLabel(data: CreateLabelDto) {
    if (data.workspaceId) {
      // Must be workspace owner or admin to create a workspace-scoped label
      const workspace = await prisma.workspace.findUnique({
        where: { id: data.workspaceId },
        select: { ownerId: true },
      });

      if (!workspace) throw new NotFoundError("Workspace not found");

      const isOwner = workspace.ownerId === data.createdById;

      if (!isOwner) {
        const admin = await prisma.workspaceMember.findFirst({
          where: {
            workspaceId: data.workspaceId,
            userId: data.createdById,
            role: "ADMIN",
          },
        });
        if (!admin)
          throw new UnauthorizedError(
            "Only workspace owner or admins can create workspace labels",
          );
      }
    }

    await LabelAccess.assertNoDuplicateName(
      data.name,
      data.workspaceId,
      data.createdById,
    );

    return prisma.label.create({
      data: {
        name: data.name,
        color: data.color,
        description: data.description,
        workspaceId: data.workspaceId,
        createdById: data.createdById,
      },
      include: labelListInclude,
    });
  },

  async updateLabel(labelId: string, userId: string, data: UpdateLabelDto) {
    const existingLabel = await prisma.label.findUnique({
      where: { id: labelId },
      include: { workspace: true },
    });

    if (!existingLabel) throw new NotFoundError("Label not found");

    const canManage = await LabelAccess.canManageLabel(existingLabel, userId);
    if (!canManage) {
      throw new UnauthorizedError(
        "Only workspace owner or admins can edit workspace labels",
      );
    }

    if (data.name && data.name !== existingLabel.name) {
      await LabelAccess.assertNoDuplicateName(
        data.name,
        existingLabel.workspaceId,
        existingLabel.createdById,
        labelId,
      );
    }

    return prisma.label.update({
      where: { id: labelId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.color !== undefined && { color: data.color }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
      },
      include: labelListInclude,
    });
  },

  async deleteLabel(labelId: string, userId: string) {
    const label = await prisma.label.findUnique({
      where: { id: labelId },
      include: { _count: { select: { tasks: true } }, workspace: true },
    });

    if (!label) throw new NotFoundError("Label not found");

    const canManage = await LabelAccess.canManageLabel(label, userId);
    if (!canManage) {
      throw new UnauthorizedError(
        "Only workspace owner or admins can delete workspace labels",
      );
    }

    await prisma.label.delete({ where: { id: labelId } });

    return { tasksAffected: label._count.tasks };
  },

  async addLabelToTask(labelId: string, taskId: string, userId: string) {
    await LabelAccess.assertTaskAccess(taskId, userId);

    const label = await prisma.label.findUnique({ where: { id: labelId } });
    if (!label) throw new NotFoundError("Label not found");

    const existing = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId, labelId } },
    });

    if (existing) throw new ConflictError("Label already added to task");

    return prisma.taskLabel.create({
      data: { taskId, labelId },
      include: taskLabelInclude,
    });
  },

  async removeLabelFromTask(labelId: string, taskId: string, userId: string) {
    await LabelAccess.assertTaskAccess(taskId, userId);

    const taskLabel = await prisma.taskLabel.findUnique({
      where: { taskId_labelId: { taskId, labelId } },
    });

    if (!taskLabel) throw new NotFoundError("Label not found on task");

    await prisma.taskLabel.delete({
      where: { taskId_labelId: { taskId, labelId } },
    });
  },
};
