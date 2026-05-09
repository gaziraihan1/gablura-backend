import { prisma } from "../../lib/prisma.js";

export const CommentAccess = {
  async assertTaskAccess(taskId: string, userId: string) {
    // const task = await prisma.task.findFirst({});
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project: { members: { some: { userId } } } },
          {
            workspace: {
              OR: [{ ownerId: userId }, { members: { some: { userId, role: "ADMIN" } } }],
            },
          },

        ],
      },
    });

    if (!task) throw new Error("Task not found or access denied");
    return task;
  },

  async assertCommentOwnership(
    commentId: string,
    taskId: string,
    userId: string,
  ) {
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, taskId },
    });

    if (!comment) throw new Error("Comment not found");

    if (comment.userId !== userId) {
      throw new Error("You cannot modify this comment");
    }

    return comment;
  },
};
