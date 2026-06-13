// activity.mutation.ts
import { prisma } from '../../lib/prisma.js';
import type { CreateActivityParams, ClearActivitiesFilters } from './activity.types.js';
import { activityFullInclude } from './activity.selects.js';
import { ActivityAccess } from './activity.access.js';

export const ActivityMutation = {
  async createActivity(params: CreateActivityParams) {
    return prisma.activity.create({
      data: {
        action:        params.action,
        entityType:    params.entityType,
        entityId:      params.entityId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug: params.workspaceSlug,   // ← added
        taskId:        params.taskId,
        metadata:      params.metadata ?? {},
      },
      include: activityFullInclude,
    });
  },

  async deleteActivity(activityId: string, callerId: string): Promise<void> {
    await ActivityAccess.assertCanDelete(callerId, activityId);
    await prisma.activity.delete({ where: { id: activityId } });
  },

  async clearUserActivities(
    userId: string,
    filters: ClearActivitiesFilters = {},
  ): Promise<number> {
    const where: Record<string, unknown> = { userId };

    if (filters.workspaceSlug) where.workspaceSlug = filters.workspaceSlug; // ← was workspaceId
    if (filters.before)        where.createdAt     = { lte: filters.before };

    const result = await prisma.activity.deleteMany({ where });
    return result.count;
  },
};