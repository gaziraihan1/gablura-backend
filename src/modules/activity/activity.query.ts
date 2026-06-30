
import { prisma } from '../../lib/prisma.js';
import type {
  ActivityFilters,
  WorkspaceActivityFilters,
  TaskActivityFilters,
} from './activity.types.js';
import {
  activityFullInclude,
  activitySlimInclude,
  activityUserOnlyInclude,
} from './activity.selects.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';
import { Prisma } from '@prisma/client';

type ActivityFull = Prisma.ActivityGetPayload<{ include: typeof activityFullInclude }>;
type ActivitySlim = Prisma.ActivityGetPayload<{ include: typeof activitySlimInclude }>;
type ActivityUserOnly = Prisma.ActivityGetPayload<{ include: typeof activityUserOnlyInclude }>;

export const ActivityQuery = {
  async getUserActivities(userId: string, filters: ActivityFilters = {}): Promise<ActivityFull[]> {
    const cacheKey = CACHE_KEYS.activityUserList(userId, filters.workspaceId);
    const cached = await CacheClient.get<ActivityFull[]>(cacheKey);
    if (cached) return cached;

    const where: Prisma.ActivityWhereInput = {
      OR: [
        { userId },
        {
          workspace: {
            OR: [
              { ownerId: userId },
              { members: { some: { userId } } },
            ],
          },
        },
        { task: { assignees: { some: { userId } } } },
        { task: { createdById: userId } },
      ],
    };

    if (filters.workspaceId) where.workspaceId = filters.workspaceId;
    if (filters.entityType)  where.entityType  = filters.entityType;
    if (filters.action)      where.action      = filters.action;

    if (filters.startDate || filters.endDate) {
      const createdAt: Prisma.ActivityWhereInput['createdAt'] = {};
      if (filters.startDate) (createdAt as any).gte = filters.startDate;
      if (filters.endDate)   (createdAt as any).lte = filters.endDate;
      where.createdAt = createdAt;
    }

    const result = await prisma.activity.findMany({
      where,
      include:  activityFullInclude,
      orderBy:  { createdAt: 'desc' },
      take:     filters.limit  ?? 50,
      skip:     filters.offset ?? 0,
    });

    await CacheClient.set(cacheKey, result, CACHE_TTL.ACTIVITY_LIST);
    return result;
  },

  async getWorkspaceActivities(
    workspaceId: string,
    filters: WorkspaceActivityFilters = {},
  ): Promise<ActivitySlim[]> {
    const cacheKey = CACHE_KEYS.activityWorkspaceList(workspaceId);
    const cached = await CacheClient.get<ActivitySlim[]>(cacheKey);
    if (cached) return cached;

    const where: Prisma.ActivityWhereInput = { workspaceId };

    if (filters.action)     where.action     = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;

    const result = await prisma.activity.findMany({
      where,
      include:  activitySlimInclude,
      orderBy:  { createdAt: 'desc' },
      take:     filters.limit  ?? 50,
      skip:     filters.offset ?? 0,
    });

    await CacheClient.set(cacheKey, result, CACHE_TTL.ACTIVITY_FEED);
    return result;
  },

  async getTaskActivities(taskId: string, filters: TaskActivityFilters = {}): Promise<ActivityUserOnly[]> {
    const cacheKey = CACHE_KEYS.activityTaskList(taskId);
    const cached = await CacheClient.get<ActivityUserOnly[]>(cacheKey);
    if (cached) return cached;

    const result = await prisma.activity.findMany({
      where:    { taskId },
      include:  activityUserOnlyInclude,
      orderBy:  { createdAt: 'desc' },
      take:     filters.limit  ?? 50,
      skip:     filters.offset ?? 0,
    });

    await CacheClient.set(cacheKey, result, CACHE_TTL.ACTIVITY_FEED);
    return result;
  },
};