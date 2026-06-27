
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

export const ActivityQuery = {
  async getUserActivities(userId: string, filters: ActivityFilters = {}): Promise<any[]> {
    const cacheKey = CACHE_KEYS.activityUserList(userId, filters.workspaceId);
    const cached = await CacheClient.get<any[]>(cacheKey);
    if (cached) return cached;

    const where: Record<string, unknown> = {
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
      const createdAt: Record<string, Date> = {};
      if (filters.startDate) createdAt.gte = filters.startDate;
      if (filters.endDate)   createdAt.lte = filters.endDate;
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
  ): Promise<any[]> {
    const cacheKey = CACHE_KEYS.activityWorkspaceList(workspaceId);
    const cached = await CacheClient.get<any[]>(cacheKey);
    if (cached) return cached;

    const where: Record<string, unknown> = { workspaceId };

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

  async getTaskActivities(taskId: string, filters: TaskActivityFilters = {}): Promise<any[]> {
    const cacheKey = CACHE_KEYS.activityTaskList(taskId);
    const cached = await CacheClient.get<any[]>(cacheKey);
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