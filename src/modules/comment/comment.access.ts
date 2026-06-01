import { prisma }                       from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

export const CommentAccess = {
  async assertTaskAccess(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project:   { members: { some: { userId } } } },
          {
            workspace: {
              OR: [
                { ownerId: userId },
                { members: { some: { userId, role: 'ADMIN' } } },
              ],
            },
          },
        ],
      },
    });

    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    return task;
  },

  async assertCommentOwnership(commentId: string, taskId: string, userId: string) {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, taskId },
    });

    if (!comment) throw new NotFoundError('Comment');
    if (comment.userId !== userId) {
      throw new ForbiddenError('You cannot modify this comment');
    }

    return comment;
  },
};