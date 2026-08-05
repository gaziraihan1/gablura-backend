import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';

export const MilestoneQuery = {
  async getByProject(projectId: string) {
    return prisma.projectMilestone.findMany({
      where:   { projectId },
      orderBy: { dueDate: 'asc' },
    });
  },

  async getById(id: string) {
    const milestone = await prisma.projectMilestone.findUnique({
      where:  { id },
      include: {
        dependsOn: true,
        dependencies: true,
        tasks: {
          select: { id: true, title: true, status: true },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!milestone) throw new NotFoundError('Milestone');
    return milestone;
  },

  async getMilestoneStats(projectId: string) {
    const milestones = await prisma.projectMilestone.findMany({
      where:  { projectId },
      select: {
        id: true,
        title: true,
        status: true,
        progress: true,
        dueDate: true,
        dependsOnId: true,
        tasks: {
          select: { id: true, title: true, status: true },
        },
      },
    });

    const total = milestones.length;
    const completed = milestones.filter((m) => m.status === 'COMPLETED').length;
    const atRisk = milestones.filter((m) => m.status === 'AT_RISK').length;
    const delayed = milestones.filter((m) => m.status === 'DELAYED').length;
    const onTrack = milestones.filter((m) => m.status === 'ON_TRACK').length;
    const avgProgress = total > 0
      ? Math.round(milestones.reduce((sum, m) => sum + m.progress, 0) / total)
      : 0;

    // Annotate each milestone with linked-task progress + counts so the UI
    // can show task-derived completion (stored progress stays manual).
    const annotated = milestones.map((m) => {
      const tasksDone = m.tasks.filter((t) => t.status === 'COMPLETED').length;
      const taskProgress = m.tasks.length > 0
        ? Math.round((tasksDone / m.tasks.length) * 100)
        : null;
      return {
        ...m,
        tasksDone,
        taskProgress,
        completed: m.status === 'COMPLETED',
      };
    });

    return { total, completed, atRisk, delayed, onTrack, avgProgress, milestones: annotated };
  },
};
