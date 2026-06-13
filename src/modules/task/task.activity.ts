import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

async function resolveWorkspaceSlug(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where:  { id: workspaceId },
    select: { slug: true },
  });
  return ws.slug;
}

export const TaskActivity = {
  async logCreated(params: {
    taskId:         string;
    taskTitle:      string;
    userId:         string;
    workspaceId:    string;
    focusRequired?: boolean;
    energyType?:    string | null;
    intent?:        string | null;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await prisma.activity.create({
        data: {
          action:        'CREATED',
          entityType:    'TASK',
          entityId:      params.taskId,
          userId:        params.userId,
          workspaceId:   params.workspaceId,
          workspaceSlug,
          taskId:        params.taskId,
          metadata: {
            taskTitle:     params.taskTitle,
            focusRequired: params.focusRequired,
            energyType:    params.energyType,
            intent:        params.intent,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log task creation activity:', error);
    }
  },

  async logStatusChanged(params: {
    taskId:      string;
    taskTitle:   string;
    userId:      string;
    workspaceId: string;
    oldStatus:   string;
    newStatus:   string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await prisma.activity.create({
        data: {
          action:        'STATUS_CHANGED',
          entityType:    'TASK',
          entityId:      params.taskId,
          userId:        params.userId,
          workspaceId:   params.workspaceId,
          workspaceSlug,
          taskId:        params.taskId,
          metadata: {
            taskTitle: params.taskTitle,
            oldStatus: params.oldStatus,
            newStatus: params.newStatus,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log status change activity:', error);
    }
  },

  async logUpdated(params: {
    taskId:      string;
    taskTitle:   string;
    userId:      string;
    workspaceId: string;
    changes:     Record<string, unknown>;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await prisma.activity.create({
        data: {
          action:        'UPDATED',
          entityType:    'TASK',
          entityId:      params.taskId,
          userId:        params.userId,
          workspaceId:   params.workspaceId,
          workspaceSlug,
          taskId:        params.taskId,
          metadata: {
  taskTitle: params.taskTitle,
  changes:   params.changes as Prisma.InputJsonValue,
},
        },
      });
    } catch (error) {
      console.error('Failed to log task update activity:', error);
    }
  },

  async logDeleted(params: {
    taskId:      string;
    taskTitle:   string;
    userId:      string;
    workspaceId: string;
    status:      string;
    priority:    string;
  }): Promise<void> {
    try {
      const workspaceSlug = await resolveWorkspaceSlug(params.workspaceId);
      await prisma.activity.create({
        data: {
          action:        'DELETED',
          entityType:    'TASK',
          entityId:      params.taskId,
          userId:        params.userId,
          workspaceId:   params.workspaceId,
          workspaceSlug,
          metadata: {
            taskTitle: params.taskTitle,
            status:    params.status,
            priority:  params.priority,
            deletedAt: new Date().toISOString(),
          },
        },
      });
    } catch (error) {
      console.error('Failed to log task deletion activity:', error);
    }
  },
};