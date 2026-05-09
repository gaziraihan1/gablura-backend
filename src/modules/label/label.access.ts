import { prisma } from '../../lib/prisma.js';
import {
  NotFoundError,
  UnauthorizedError,
  ConflictError,
} from './label.types.js';

interface LabelForPermission {
  createdById: string;
  workspaceId: string | null;
}

export const LabelAccess = {
  async assertLabelAccess(labelId: string, userId: string) {
    const label = await prisma.label.findUnique({
      where:   { id: labelId },
      include: { workspace: true },
    });

    if (!label) throw new NotFoundError('Label not found');

    if (label.workspaceId) {
      const member = await prisma.workspaceMember.findFirst({
        where: { workspaceId: label.workspaceId, userId },
      });
      if (!member) throw new UnauthorizedError('Access denied');
    } else if (label.createdById !== userId) {
      throw new UnauthorizedError('Access denied');
    }

    return label;
  },

  async canEditLabel(label: LabelForPermission, userId: string): Promise<boolean> {
    if (label.createdById === userId) return true;

    if (label.workspaceId) {
      const workspace = await prisma.workspace.findUnique({
        where:  { id: label.workspaceId },
        select: { ownerId: true },
      });

      if (workspace?.ownerId === userId) return true;

      const adminMember = await prisma.workspaceMember.findFirst({
        where: { workspaceId: label.workspaceId, userId, role: 'ADMIN' },
      });

      return !!adminMember;
    }

    return false;
  },

  async assertNoDuplicateName(
    name:           string,
    workspaceId:    string | null | undefined,
    createdById:    string,
    excludeLabelId?: string,
  ): Promise<void> {
    const where: Record<string, unknown> = {
      name: { equals: name, mode: 'insensitive' },
    };

    if (workspaceId) {
      where.workspaceId = workspaceId;
    } else {
      where.workspaceId = null;
      where.createdById = createdById;
    }

    if (excludeLabelId) {
      where.id = { not: excludeLabelId };
    }

    const existing = await prisma.label.findFirst({ where });

    if (existing) {
      const scope = workspaceId ? 'workspace' : 'your personal labels';
      throw new ConflictError(`Label with this name already exists in ${scope}`);
    }
  },

  async assertTaskAccess(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { workspace: { ownerId: userId } } },
          {
            project: {
              workspace: {
                members: { some: { userId, role: 'ADMIN' } },
              },
            },
          },
          {
            project: {
              members: { some: { userId } },
            },
          },
        ],
      },
      select: { id: true },
    });

    if (!task) throw new NotFoundError('Task not found or access denied');

    return task;
  },

  async accessibleTaskIds(
    taskIds: string[],
    userId:  string,
  ): Promise<Set<string>> {
    if (taskIds.length === 0) return new Set();

    const accessible = await prisma.task.findMany({
      where: {
        id: { in: taskIds },
        OR: [
          { createdById: userId },
          { assignees:   { some: { userId } } },
          { project: { workspace: { ownerId: userId } } },
          {
            project: {
              workspace: {
                members: { some: { userId, role: 'ADMIN' } },
              },
            },
          },
          {
            project: {
              members: { some: { userId, role: 'MANAGER' } },
            },
          },
        ],
      },
      select: { id: true },
    });

    return new Set(accessible.map((t) => t.id));
  },
  async canManageLabel(label: LabelForPermission, userId: string): Promise<boolean> {
  // Personal label → creator only
  if (!label.workspaceId) return label.createdById === userId;

  // Workspace label → owner or admin only (creator alone is NOT enough)
  const workspace = await prisma.workspace.findUnique({
    where:  { id: label.workspaceId },
    select: { ownerId: true },
  });

  if (workspace?.ownerId === userId) return true;

  const admin = await prisma.workspaceMember.findFirst({
    where: { workspaceId: label.workspaceId, userId, role: 'ADMIN' },
  });

  return !!admin;
},
};