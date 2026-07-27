// activity.mutation.ts
import { prisma } from '../../lib/prisma.js';
import type { CreateActivityParams, ClearActivitiesFilters } from './activity.types.js';
import { activityFullInclude } from './activity.selects.js';
import { ActivityAccess } from './activity.access.js';
import { NotFoundError } from '../../errors/index.js';
import { addInvalidateCacheJob } from '../../queue/index.js';

export const ActivityMutation = {
  async createActivity(params: CreateActivityParams) {
    const activity = await prisma.activity.create({
      data: {
        action:        params.action,
        entityType:    params.entityType,
        entityId:      params.entityId,
        userId:        params.userId,
        workspaceId:   params.workspaceId,
        workspaceSlug: params.workspaceSlug,
        taskId:        params.taskId,
        metadata:      params.metadata ?? {},
      },
      include: activityFullInclude,
    });

    // Invalidate relevant caches (non-blocking via queue)
    addInvalidateCacheJob({
      type: 'activity',
      workspaceId: params.workspaceId,
      userId: params.userId,
      taskId: params.taskId,
    }).catch(() => {});

    return activity;
  },

  async deleteActivity(activityId: string, callerId: string): Promise<void> {
    const activity = await prisma.activity.findUnique({
      where: { id: activityId },
    });

    if (!activity) throw new NotFoundError('Activity');

    await ActivityAccess.assertCanDelete(callerId, activityId);
    await prisma.activity.delete({ where: { id: activityId } });

    // Invalidate relevant caches (non-blocking via queue)
    addInvalidateCacheJob({
      type: 'activity',
      workspaceId: activity.workspaceId ?? undefined,
      userId: activity.userId,
      taskId: activity.taskId ?? undefined,
    }).catch(() => {});
  },

  async clearUserActivities(
    userId: string,
    filters: ClearActivitiesFilters = {},
  ): Promise<number> {
    const where: Record<string, unknown> = { userId };

    if (filters.workspaceId)   where.workspaceId   = filters.workspaceId;
    if (filters.workspaceSlug) where.workspaceSlug = filters.workspaceSlug;
    if (filters.before)        where.createdAt     = { lte: filters.before };

    const result = await prisma.activity.deleteMany({ where });

    // Invalidate user activity caches (non-blocking via queue)
    addInvalidateCacheJob({
      type: 'activity',
      userId,
    }).catch(() => {});

    return result.count;
  },
};