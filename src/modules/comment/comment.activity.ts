
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export const CommentActivity = {
  async logCreated(params: {
    commentId:      string;
    taskId:         string;
    taskTitle:      string;
    userId:         string;
    workspaceId:    string;
    workspaceSlug?: string;
    commentPreview: string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'COMMENTED',
          entityType:  'COMMENT',
          entityId:    params.commentId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug || '', // Optional: you can include this if you have it available in params
          taskId:      params.taskId,
          metadata: {
            taskTitle:      params.taskTitle,
            commentPreview: params.commentPreview,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log comment creation:', error);
    }
  },

  async logUpdated(params: {
    commentId:   string;
    taskId:      string;
    taskTitle:   string;
    userId:      string;
    workspaceId: string;
    workspaceSlug?: string;
    oldContent:  string;
    newContent:  string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'UPDATED',
          entityType:  'COMMENT',
          entityId:    params.commentId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug || "", // Optional: you can include this if you have it available in params
          taskId:      params.taskId,
          metadata: {
            taskTitle:  params.taskTitle,
            oldContent: params.oldContent,
            newContent: params.newContent,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log comment update:', error);
    }
  },

  async logDeleted(params: {
    commentId:      string;
    taskId:         string;
    taskTitle:      string;
    userId:         string;
    workspaceId:    string;
    workspaceSlug?: string;
    commentContent: string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action:      'DELETED',
          entityType:  'COMMENT',
          entityId:    params.commentId,
          userId:      params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug:params.workspaceSlug || '', // Optional: you can include this if you have it available in params
          taskId:      params.taskId,
          metadata: {
            taskTitle:      params.taskTitle,
            commentContent: params.commentContent,
          },
        },
      });
    } catch (error) {
      console.error('Failed to log comment deletion:', error);
    }
  },
};

export const taskForActivitySelect = {
  id:          true,
  title:       true,
  createdById: true,          // ← needed for creator check
  createdBy: {
    select: {
      id:            true,
      notifications: true,    // ← needed for preference check
    },
  },
  project: {
    select: {
      workspaceId: true,
    },
  },
} satisfies Prisma.TaskSelect;