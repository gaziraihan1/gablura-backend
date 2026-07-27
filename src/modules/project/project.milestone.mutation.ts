import { prisma } from '../../lib/prisma.js';
import { NotFoundError, BadRequestError } from '../../errors/index.js';
import { ProjectAccess } from './project.access.js';
import { ProjectCache } from '../../lib/redis/cache.client.js';
import type { CreateMilestoneDto, UpdateMilestoneDto } from './project.milestone.types.js';

export const MilestoneMutation = {
  async create(data: CreateMilestoneDto, userId: string) {
    await ProjectAccess.assertProjectAdminAccess(userId, data.projectId);
    await ProjectAccess.assertProjectNotArchived(data.projectId);

    // Validate dependency exists if set
    if (data.dependsOnId) {
      const dep = await prisma.projectMilestone.findUnique({ where: { id: data.dependsOnId } });
      if (!dep || dep.projectId !== data.projectId) {
        throw new BadRequestError('Dependency milestone not found');
      }
    }

    const milestone = await prisma.projectMilestone.create({ data });

    ProjectCache.invalidateProject(data.projectId).catch(() => {});
    return milestone;
  },

  async update(id: string, data: UpdateMilestoneDto, userId: string) {
    const milestone = await prisma.projectMilestone.findUnique({
      where:  { id },
      select: { id: true, projectId: true },
    });
    if (!milestone) throw new NotFoundError('Milestone');

    await ProjectAccess.assertProjectAdminAccess(userId, milestone.projectId);
    await ProjectAccess.assertProjectNotArchived(milestone.projectId);

    const updateData: any = { ...data };

    // Auto-set status/progress/completedAt
    if (data.completed === true) {
      updateData.status = 'COMPLETED';
      updateData.progress = 100;
      updateData.completedAt = new Date();
    }

    const updated = await prisma.projectMilestone.update({ where: { id }, data: updateData });

    ProjectCache.invalidateProject(milestone.projectId).catch(() => {});
    return updated;
  },

  async delete(id: string, userId: string) {
    const milestone = await prisma.projectMilestone.findUnique({
      where:  { id },
      select: { id: true, projectId: true },
    });
    if (!milestone) throw new NotFoundError('Milestone');

    await ProjectAccess.assertProjectAdminAccess(userId, milestone.projectId);
    await ProjectAccess.assertProjectNotArchived(milestone.projectId);

    // Check if other milestones depend on this one
    const dependents = await prisma.projectMilestone.findMany({
      where:  { dependsOnId: id },
      select: { id: true, title: true },
    });
    if (dependents.length > 0) {
      throw new BadRequestError(
        `Cannot delete milestone: "${dependents[0].title}" depends on it. Remove the dependency first.`,
      );
    }

    await prisma.projectMilestone.delete({ where: { id } });
    ProjectCache.invalidateProject(milestone.projectId).catch(() => {});
  },

  async updateProgress(id: string, progress: number, userId: string) {
    if (progress < 0 || progress > 100) {
      throw new BadRequestError('Progress must be between 0 and 100');
    }

    const milestone = await prisma.projectMilestone.findUnique({
      where:  { id },
      select: { id: true, projectId: true, status: true },
    });
    if (!milestone) throw new NotFoundError('Milestone');

    await ProjectAccess.assertProjectAdminAccess(userId, milestone.projectId);
    await ProjectAccess.assertProjectNotArchived(milestone.projectId);

    const updateData: any = { progress };
    if (progress === 100) {
      updateData.status = 'COMPLETED';
      updateData.completed = true;
      updateData.completedAt = new Date();
    } else if (milestone.status === 'ON_TRACK' || milestone.status === 'AT_RISK' || milestone.status === 'DELAYED') {
      // Keep existing status when progress is being updated
    }

    return prisma.projectMilestone.update({ where: { id }, data: updateData });
  },
};
