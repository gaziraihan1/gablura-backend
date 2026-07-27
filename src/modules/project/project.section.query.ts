import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';

export const SectionQuery = {
  async getByProject(projectId: string) {
    return prisma.projectSection.findMany({
      where:  { projectId },
      orderBy: { position: 'asc' },
    });
  },

  async getById(id: string) {
    const section = await prisma.projectSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundError('Section');
    return section;
  },


};
