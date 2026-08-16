import { prisma }                       from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

export const TimeEntryAccess = {
  /**
   * A user may log time on a task they can see: creator, assignee,
   * project member, or workspace owner/admin. Mirrors the comment module.
   */
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
      select: { id: true, workspaceId: true },
    });

    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    return task;
  },

  /**
   * Time entries are personal records — only the author can edit or
   * delete them.
   */
  async assertEntryOwnership(entryId: string, userId: string) {
    const entry = await prisma.timeEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry) throw new NotFoundError('Time entry', 'TIME_ENTRY_NOT_FOUND');
    if (entry.userId !== userId) {
      throw new ForbiddenError('You can only modify your own time entries');
    }

    return entry;
  },
};
