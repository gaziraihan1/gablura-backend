import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../errors/index.js';
import { ProjectAccess } from './project.access.js';
import type { CreateSectionDto, UpdateSectionDto } from './project.section.types.js';
import type { TaskStatus } from '@prisma/client';

async function assertStatusAvailable(projectId: string, taskStatus: TaskStatus) {
  const existing = await prisma.projectSection.findFirst({
    where: { projectId, taskStatus },
  });
  if (existing) {
    throw new BadRequestError('A section for this task status already exists');
  }
}

export const SectionMutation = {
  async create(data: CreateSectionDto, userId: string) {
    await ProjectAccess.assertProjectAdminAccess(userId, data.projectId);
    await ProjectAccess.assertProjectNotArchived(data.projectId);

    if (data.taskStatus) {
      await assertStatusAvailable(data.projectId, data.taskStatus);
    }

    const createData: CreateSectionDto = { ...data };
    if (data.position === undefined) {
      const last = await prisma.projectSection.findFirst({
        where:  { projectId: data.projectId },
        orderBy: { position: 'desc' },
        select:  { position: true },
      });
      createData.position = (last?.position ?? -1) + 1;
    }

    return prisma.projectSection.create({ data: createData });
  },

  async update(id: string, data: UpdateSectionDto, userId: string) {
    const section = await prisma.projectSection.findUnique({ where: { id } });
    if (!section) throw new NotFoundError('Section');

    await ProjectAccess.assertProjectAdminAccess(userId, section.projectId);
    await ProjectAccess.assertProjectNotArchived(section.projectId);

    if (data.taskStatus && data.taskStatus !== section.taskStatus) {
      await assertStatusAvailable(section.projectId, data.taskStatus);
    }

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
