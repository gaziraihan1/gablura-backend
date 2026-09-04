
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

/**
 * Gablura-admin audit rows (metadata.source === 'gablura-admin', e.g. workspace
 * limits / AI cap changes) are excluded from user-facing feeds — they surface
 * only in the admin activity log. Filtered in app code because a SQL
 * `NOT (json->>'source' = 'gablura-admin')` is NULL for rows without the key
 * and would silently drop them too.
 */
function isAdminAuditRow(metadata: Prisma.JsonValue | null): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>).source === 'gablura-admin';
}

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
    const filtered = result.filter((a) => !isAdminAuditRow(a.metadata));

    await CacheClient.set(cacheKey, filtered, CACHE_TTL.ACTIVITY_LIST);
    return filtered;
  },

  async getWorkspaceActivities(
    workspaceId: string,
    filters: WorkspaceActivityFilters = {},
    opts?: { includeAdminRows?: boolean },
  ): Promise<ActivitySlim[]> {
    const cacheKey = CACHE_KEYS.activityWorkspaceList(workspaceId);

    // The admin variant (workspace owners/admins) includes Gablura-admin audit
    // rows, so it must not share the member cache — read fresh from the DB.
    if (!opts?.includeAdminRows) {
      const cached = await CacheClient.get<ActivitySlim[]>(cacheKey);
      if (cached) return cached;
    }

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
    const filtered = opts?.includeAdminRows
      ? result
      : result.filter((a) => !isAdminAuditRow(a.metadata));

    if (!opts?.includeAdminRows) {
      await CacheClient.set(cacheKey, filtered, CACHE_TTL.ACTIVITY_FEED);
    }
    return filtered;
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