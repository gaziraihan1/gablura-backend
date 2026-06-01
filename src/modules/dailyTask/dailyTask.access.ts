import { prisma }          from '../../lib/prisma.js';
import { NotFoundError }   from '../../errors/index.js';
import { taskWorkspaceInclude } from './dailyTask.selects.js';

export const DailyTaskAccess = {
  async findAccessibleTask(userId: string, taskId: string) {
    return prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project:    { members: { some: { userId } } } },
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
      include: taskWorkspaceInclude,
    });
  },

  async assertTaskAccess(userId: string, taskId: string) {
    const task = await this.findAccessibleTask(userId, taskId);
    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    return task;
  },
};