import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentActivity } from '../../../modules/comment/comment.activity.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    activity: { create: vi.fn() },
  },
}));

describe('CommentActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('logCreated', () => {
    it('should create an activity record for comment creation', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await CommentActivity.logCreated({
        commentId: 'c1',
        taskId: 't1',
        taskTitle: 'Test Task',
        userId: 'u1',
        workspaceId: 'ws1',
        commentPreview: 'Hello world',
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          action: 'COMMENTED',
          entityType: 'COMMENT',
          entityId: 'c1',
          userId: 'u1',
          workspaceId: 'ws1',
          workspaceSlug: '',
          taskId: 't1',
          metadata: {
            taskTitle: 'Test Task',
            commentPreview: 'Hello world',
          },
        },
      });
    });

    it('should not throw when prisma fails (fire-and-forget)', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(
        CommentActivity.logCreated({
          commentId: 'c1',
          taskId: 't1',
          taskTitle: 'Task',
          userId: 'u1',
          workspaceId: 'ws1',
          commentPreview: 'text',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('logUpdated', () => {
    it('should create an activity record for comment update', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await CommentActivity.logUpdated({
        commentId: 'c1',
        taskId: 't1',
        taskTitle: 'Test Task',
        userId: 'u1',
        workspaceId: 'ws1',
        oldContent: 'old',
        newContent: 'new',
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          action: 'UPDATED',
          entityType: 'COMMENT',
          entityId: 'c1',
          userId: 'u1',
          workspaceId: 'ws1',
          workspaceSlug: '',
          taskId: 't1',
          metadata: {
            taskTitle: 'Test Task',
            oldContent: 'old',
            newContent: 'new',
          },
        },
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(
        CommentActivity.logUpdated({
          commentId: 'c1',
          taskId: 't1',
          taskTitle: 'Task',
          userId: 'u1',
          workspaceId: 'ws1',
          oldContent: 'old',
          newContent: 'new',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('logDeleted', () => {
    it('should create an activity record for comment deletion', async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await CommentActivity.logDeleted({
        commentId: 'c1',
        taskId: 't1',
        taskTitle: 'Test Task',
        userId: 'u1',
        workspaceId: 'ws1',
        commentContent: 'deleted text',
      });

      expect(prisma.activity.create).toHaveBeenCalledWith({
        data: {
          action: 'DELETED',
          entityType: 'COMMENT',
          entityId: 'c1',
          userId: 'u1',
          workspaceId: 'ws1',
          workspaceSlug: '',
          taskId: 't1',
          metadata: {
            taskTitle: 'Test Task',
            commentContent: 'deleted text',
          },
        },
      });
    });

    it('should not throw when prisma fails', async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(new Error('DB error'));

      await expect(
        CommentActivity.logDeleted({
          commentId: 'c1',
          taskId: 't1',
          taskTitle: 'Task',
          userId: 'u1',
          workspaceId: 'ws1',
          commentContent: 'text',
        }),
      ).resolves.not.toThrow();
    });
  });
});
