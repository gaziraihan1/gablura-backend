import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import { ProjectAccess } from './project.access.js';
import type { CreateSectionDto, UpdateSectionDto } from './project.section.types.js';

export const SectionMutation = {
  async create(data: CreateSectionDto, userId: string) {
    await ProjectAccess.assertProjectAdminAccess(userId, data.projectId);
    await ProjectAccess.assertProjectNotArchived(data.projectId);

    return prisma.projectSection.create({ data });
  },

  async update(id: string, data: UpdateSectionDto, userId: string) {
    const section = await prisma.projectSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundError('Section');

    await ProjectAccess.assertProjectAdminAccess(userId, section.projectId);
    await ProjectAccess.assertProjectNotArchived(section.projectId);

    return prisma.projectSection.update({ where: { id }, data });
  },

  async delete(id: string, userId: string) {
    const section = await prisma.projectSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundError('Section');

    await ProjectAccess.assertProjectAdminAccess(userId, section.projectId);
    await ProjectAccess.assertProjectNotArchived(section.projectId);

    await prisma.projectSection.delete({ where: { id } });
  },

  async reorder(projectId: string, sectionIds: string[], userId: string) {
    await ProjectAccess.assertProjectAdminAccess(userId, projectId);
    await ProjectAccess.assertProjectNotArchived(projectId);

    await prisma.$transaction(
      sectionIds.map((id, index) =>
        prisma.projectSection.update({
          where: { id },
          data:  { position: index },
        }),
      ),
    );
  },
};
