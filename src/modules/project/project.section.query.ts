import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';

export const SectionQuery = {
  async getByProject(projectId: string) {
    return prisma.projectSection.findMany({
      where:  { projectId },
      orderBy: { position: 'asc' },
      // Task counts let the UI show how many tasks live in each section
      include: {
        _count: { select: { tasks: true } },
      },
    });
  },

  async getById(id: string) {
    const section = await prisma.projectSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundError('Section');
    return section;
  },


};
