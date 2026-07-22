import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentQuery } from '../../../modules/comment/comment.query.js';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError } from '../../../errors/AppError.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    comment: { findMany: vi.fn() },
    task: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../modules/comment/comment.selects.js', () => ({
  commentFullInclude: { user: true, replies: true, mentions: true },
}));

describe('CommentQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getComments', () => {
    it('should return comments for a task', async () => {
      const mockComments = [
        { id: 'c1', content: 'First', taskId: 't1', parentId: null },
        { id: 'c2', content: 'Second', taskId: 't1', parentId: null },
      ];
      vi.mocked(prisma.comment.findMany).mockResolvedValue(mockComments as any);

      const result = await CommentQuery.getComments('t1', 'u1');

      expect(result).toHaveLength(2);
      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ taskId: 't1', parentId: null }),
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('should return empty array when no comments exist and task is accessible', async () => {
      vi.mocked(prisma.comment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      const result = await CommentQuery.getComments('t1', 'u1');

      expect(result).toEqual([]);
    });

    it('should throw NotFoundError when task is not accessible', async () => {
      vi.mocked(prisma.comment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);

      await expect(CommentQuery.getComments('t1', 'u1')).rejects.toThrow(NotFoundError);
    });

    it('should not check task access when comments exist', async () => {
      vi.mocked(prisma.comment.findMany).mockResolvedValue([
        { id: 'c1', content: 'Hello' },
      ] as any);

      await CommentQuery.getComments('t1', 'u1');

      expect(prisma.task.findFirst).not.toHaveBeenCalled();
    });

    it('should filter by parentId null for top-level comments', async () => {
      vi.mocked(prisma.comment.findMany).mockResolvedValue([]);
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      await CommentQuery.getComments('t1', 'u1');

      const call = vi.mocked(prisma.comment.findMany).mock.calls[0]![0];
      expect((call!.where as any).parentId).toBeNull();
    });
  });
});
