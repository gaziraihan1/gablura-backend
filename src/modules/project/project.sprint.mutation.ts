import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../errors/index.js';
import { ProjectAccess } from './project.access.js';
import type { CreateSprintDto, UpdateSprintDto } from './project.sprint.types.js';

export const SprintMutation = {
  async create(data: CreateSprintDto, userId: string) {
    await ProjectAccess.assertProjectAdminAccess(userId, data.projectId);
    await ProjectAccess.assertProjectNotArchived(data.projectId);

    // Validate date range
    if (data.endDate <= data.startDate) {
      throw new BadRequestError('End date must be after start date');
    }

    return prisma.sprint.create({ data });
  },

  async update(id: string, data: UpdateSprintDto, userId: string) {
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundError('Sprint');

    await ProjectAccess.assertProjectAdminAccess(userId, sprint.projectId);
    await ProjectAccess.assertProjectNotArchived(sprint.projectId);

    const updateData: any = { ...data };

    // Auto-set completedAt when status changes to COMPLETED
    if (data.status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }

    return prisma.sprint.update({ where: { id }, data: updateData });
  },

  async delete(id: string, userId: string) {
    const sprint = await prisma.sprint.findUnique({ where: { id } });
    if (!sprint) throw new NotFoundError('Sprint');

    await ProjectAccess.assertProjectAdminAccess(userId, sprint.projectId);
    await ProjectAccess.assertProjectNotArchived(sprint.projectId);

    await prisma.sprint.delete({ where: { id } });
  },

  async complete(id: string, userId: string, retrospective?: string) {
    const sprint = await prisma.sprint.findUnique({
      where:  { id },
      include: {
        project: {
          select: {
            tasks: {
              where:  { sprintId: id },
              select: { status: true, estimatedHours: true, actualHours: true },
            },
          },
        },
      },
    });
    if (!sprint) throw new NotFoundError('Sprint');

    await ProjectAccess.assertProjectAdminAccess(userId, sprint.projectId);
    await ProjectAccess.assertProjectNotArchived(sprint.projectId);

    // Calculate velocity from actual hours / estimated hours
    const tasks = sprint.project.tasks;
    const totalPoints = tasks.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
    const completedPoints = tasks
      .filter((t) => t.status === 'COMPLETED')
      .reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0);
    const velocity = tasks.length > 0
      ? tasks.filter((t) => t.actualHours != null && t.estimatedHours != null)
          .reduce((sum, t) => sum + ((t.actualHours ?? 0) / (t.estimatedHours ?? 1)), 0) / tasks.length
      : null;

    return prisma.sprint.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        retrospective,
        totalPoints,
        completedPoints,
        velocity: velocity ? Math.round(velocity * 100) / 100 : null,
      },
    });
  },
};
