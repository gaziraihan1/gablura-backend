import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import { ProjectAccess } from './project.access.js';
import { ProjectCache } from '../../lib/redis/cache.client.js';
import type { CreateProjectViewDto, UpdateProjectViewDto } from './project.view.types.js';

export const ProjectViewMutation = {
  async create(data: CreateProjectViewDto, userId: string) {
    await ProjectAccess.assertProjectAdminAccess(userId, data.projectId);
    await ProjectAccess.assertProjectNotArchived(data.projectId);

    // If this is the first view, make it default
    const existingCount = await prisma.projectView.count({
      where: { projectId: data.projectId },
    });

    // If setting as default, unset all others
    if (data.isDefault) {
      await prisma.projectView.updateMany({
        where:  { projectId: data.projectId },
        data:   { isDefault: false },
      });
    }

    const view = await prisma.projectView.create({
      data: {
        name: data.name,
        description: data.description,
        type: data.type,
        filters: data.filters as any,
        sort: data.sort as any,
        config: data.config as any,
        isDefault: data.isDefault ?? existingCount === 0,
        visibility: data.visibility,
        projectId: data.projectId,
        createdById: data.createdById,
      },
    });

    ProjectCache.invalidateProject(data.projectId).catch(() => {});
    return view;
  },

  async update(id: string, data: UpdateProjectViewDto, userId: string) {
    const view = await prisma.projectView.findUnique({
      where:  { id },
      select: { id: true, projectId: true, createdById: true },
    });
    if (!view) throw new NotFoundError('View');

    await ProjectAccess.assertProjectAdminAccess(userId, view.projectId);
    await ProjectAccess.assertProjectNotArchived(view.projectId);

    // If setting as default, unset all others
    if (data.isDefault) {
      await prisma.projectView.updateMany({
        where:  { projectId: view.projectId, id: { not: id } },
        data:   { isDefault: false },
      });
    }

    const updated = await prisma.projectView.update({ where: { id }, data: data as any });

    ProjectCache.invalidateProject(view.projectId).catch(() => {});
    return updated;
  },

  async delete(id: string, userId: string) {
    const view = await prisma.projectView.findUnique({
      where:  { id },
      select: { id: true, projectId: true },
    });
    if (!view) throw new NotFoundError('View');

    await ProjectAccess.assertProjectAdminAccess(userId, view.projectId);
    await ProjectAccess.assertProjectNotArchived(view.projectId);

    await prisma.projectView.delete({ where: { id } });
    ProjectCache.invalidateProject(view.projectId).catch(() => {});
  },
};
