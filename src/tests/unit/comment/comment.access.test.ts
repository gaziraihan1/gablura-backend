import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentAccess } from '../../../modules/comment/comment.access.js';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError, ForbiddenError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    task: { findFirst: vi.fn() },
    comment: { findFirst: vi.fn() },
  },
}));

describe('CommentAccess', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('assertTaskAccess', () => {
    it('should return task when user is the creator', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      const result = await CommentAccess.assertTaskAccess('t1', 'u1');
      expect(result.id).toBe('t1');
    });

    it('should throw NotFoundError when user has no access', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);

      await expect(CommentAccess.assertTaskAccess('t1', 'u1')).rejects.toThrow(NotFoundError);
    });

    it('should pass correct where clause with OR conditions', async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 't1' } as any);

      await CommentAccess.assertTaskAccess('t1', 'u1');

      expect(prisma.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: 't1',
          OR: [
            { createdById: 'u1' },
            { assignees: { some: { userId: 'u1' } } },
            { project: { members: { some: { userId: 'u1' } } } },
            {
              workspace: {
                OR: [
                  { ownerId: 'u1' },
                  { members: { some: { userId: 'u1', role: 'ADMIN' } } },
                ],
              },
            },
          ],
        },
      });
    });
  });

  describe('assertCommentOwnership', () => {
    it('should return comment when user is the owner', async () => {
      vi.mocked(prisma.comment.findFirst).mockResolvedValue({
        id: 'c1',
        userId: 'u1',
      } as any);

      const result = await CommentAccess.assertCommentOwnership('c1', 't1', 'u1');
      expect(result.id).toBe('c1');
    });

    it('should throw NotFoundError when comment does not exist', async () => {
      vi.mocked(prisma.comment.findFirst).mockResolvedValue(null);

      await expect(
        CommentAccess.assertCommentOwnership('c1', 't1', 'u1'),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw ForbiddenError when user is not the owner', async () => {
      vi.mocked(prisma.comment.findFirst).mockResolvedValue({
        id: 'c1',
        userId: 'other-user',
      } as any);

      await expect(
        CommentAccess.assertCommentOwnership('c1', 't1', 'u1'),
      ).rejects.toThrow(ForbiddenError);
    });

    it('should query with both commentId and taskId', async () => {
      vi.mocked(prisma.comment.findFirst).mockResolvedValue({
        id: 'c1',
        userId: 'u1',
      } as any);

      await CommentAccess.assertCommentOwnership('c1', 't1', 'u1');

      expect(prisma.comment.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', taskId: 't1' },
      });
    });
  });
});
