import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';

export const ProjectViewQuery = {
  async getByProject(projectId: string, userId: string) {
    return prisma.projectView.findMany({
      where: {
        projectId,
        OR: [
          { createdById: userId },
          { visibility: 'SHARED' },
        ],
      },
      orderBy: { id: 'asc' },
    });
  },

  async getById(id: string) {
    const view = await prisma.projectView.findUnique({ where: { id } });
    if (!view) throw new NotFoundError('View');
    return view;
  },

  async getDefaultView(projectId: string) {
    return prisma.projectView.findFirst({
      where: { projectId, isDefault: true },
    });
  },
};
