import { NotFoundError } from '../../errors/AppError.js';
import { prisma } from '../../lib/prisma.js';
import { commentFullInclude } from './comment.selects.js';

export const CommentQuery = {
  async getComments(taskId: string, userId: string) {
    // Single query — access check embedded in where clause, eliminates serial round-trip
    const comments = await prisma.comment.findMany({
      where: {
        taskId,
        parentId: null, // top-level only; replies are nested via commentFullInclude
        task: {
          OR: [
            { createdById: userId },
            { assignees:   { some: { userId } } },
            { project:     { workspace: { members: { some: { userId } } } } },
            { workspace:   { members: { some: { userId } } } },
          ],
        },
      },
      include: commentFullInclude,
      orderBy: { createdAt: 'asc' },
    });

    // If empty, confirm whether it's truly empty vs access denied
    if (comments.length === 0) {
      const taskExists = await prisma.task.findFirst({
        where: {
          id: taskId,
          OR: [
            { createdById: userId },
            { assignees:   { some: { userId } } },
            { project:     { workspace: { members: { some: { userId } } } } },
            { workspace:   { members: { some: { userId } } } },
          ],
        },
        select: { id: true },
      });
      if (!taskExists) throw new NotFoundError('Task');
    }

    return comments;
  },
};