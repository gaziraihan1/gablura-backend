import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';

export const SprintQuery = {
  async getByProject(projectId: string) {
    return prisma.sprint.findMany({
      where:   { projectId },
      orderBy: { startDate: 'desc' },
      include: { _count: { select: { tasks: true } } },
    });
  },

  async getActiveSprint(projectId: string) {
    return prisma.sprint.findFirst({
      where: { projectId, status: 'ACTIVE' },
    });
  },

  async getById(id: string, projectId?: string) {
    const sprint = await prisma.sprint.findFirst({
      where: {
        id,
        ...(projectId ? { projectId } : {}),
      },
      include: {
        project: {
          select: {
            tasks: {
              where:  { sprintId: id },
              orderBy: { position: 'asc' },
              include: {
                assignees: { include: { user: { select: { id: true, name: true, image: true } } } },
                labels:    { include: { label: true } },
              },
            },
          },
        },
      },
    });
    if (!sprint) throw new NotFoundError('Sprint');
    return sprint;
  },

  async getSprintStats(projectId: string) {
    const sprints = await prisma.sprint.findMany({
      where:   { projectId },
      orderBy: { endDate: 'desc' },
      select:  {
        id: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        totalPoints: true,
        completedPoints: true,
        velocity: true,
        _count: { select: { tasks: true } },
      },
    });

    const activeSprint = sprints.find((s) => s.status === 'ACTIVE');
    const avgVelocity = sprints
      .filter((s) => s.velocity != null)
      .reduce((sum, s, _, arr) => sum + (s.velocity ?? 0) / arr.length, 0);

    return { sprints, activeSprint, avgVelocity };
  },
};
