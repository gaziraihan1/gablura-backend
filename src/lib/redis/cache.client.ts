// ─── Cache TTL Configuration (in seconds) ─────────────────────────────────────
// These values can be overridden via environment variables

import { getRedisClient } from "../../redis/redis.client.js";

export const CACHE_TTL = {
  WORKSPACE_METADATA: parseInt(
    process.env.CACHE_TTL_WORKSPACE_METADATA ?? "3600",
  ), // 1 hour
  LABEL_LIST: parseInt(process.env.CACHE_TTL_LABEL_LIST ?? "1800"), // 30 minutes
  ANALYTICS_DASHBOARD: parseInt(process.env.CACHE_TTL_ANALYTICS ?? "3600"), // 1 hour
  WORKSPACE_OVERVIEW: parseInt(
    process.env.CACHE_TTL_WORKSPACE_OVERVIEW ?? "3600",
  ), // 1 hour
  WORKSPACE_STATS: parseInt(process.env.CACHE_TTL_WORKSPACE_STATS ?? "1800"), // 30 minutes

  // Storage — shorter TTLs because usage numbers change on every upload/delete
  STORAGE_WORKSPACES_SUMMARY: parseInt(
    process.env.CACHE_TTL_STORAGE_WORKSPACES_SUMMARY ?? "120",
  ), // 2 min
  STORAGE_OVERVIEW: parseInt(process.env.CACHE_TTL_STORAGE_OVERVIEW ?? "60"), // 1 min
  STORAGE_INFO: parseInt(process.env.CACHE_TTL_STORAGE_INFO ?? "60"), // 1 min
  STORAGE_MY_CONTRIBUTION: parseInt(
    process.env.CACHE_TTL_STORAGE_MY_CONTRIBUTION ?? "60",
  ), // 1 min
  STORAGE_USER_CONTRIBUTIONS: parseInt(
    process.env.CACHE_TTL_STORAGE_USER_CONTRIBUTIONS ?? "120",
  ), // 2 min
  STORAGE_LARGEST_FILES: parseInt(
    process.env.CACHE_TTL_STORAGE_LARGEST_FILES ?? "120",
  ), // 2 min
} as const;

// ─── Cache Key Generators ─────────────────────────────────────────────────────

export const CACHE_KEYS = {
  // Workspace metadata caching
  workspaceById: (workspaceId: string) => `workspace:id:${workspaceId}`,
  workspaceBySlug: (slug: string) => `workspace:slug:${slug}`,
  workspaceOverview: (slug: string) => `workspace:overview:${slug}`,
  workspaceStats: (workspaceId: string) => `workspace:stats:${workspaceId}`,
  workspaceMembers: (workspaceId: string) => `workspace:members:${workspaceId}`,
  userWorkspaces: (userId: string) => `user:workspaces:${userId}`,

  // Label caching
  labelList: (userId: string, workspaceId: string | null) =>
    `labels:list:${userId}:${workspaceId ?? "personal"}`,
  labelById: (labelId: string) => `label:id:${labelId}`,
  popularLabels: (userId: string, workspaceId: string | null) =>
    `labels:popular:${userId}:${workspaceId ?? "personal"}`,

  // Analytics caching
  analyticsOverview: (workspaceId: string) =>
    `analytics:overview:${workspaceId}`,
  analyticsKPIs: (workspaceId: string) => `analytics:kpis:${workspaceId}`,
  analyticsTaskTrends: (workspaceId: string, days: number) =>
    `analytics:task-trends:${workspaceId}:${days}`,
  analyticsProjectHealth: (workspaceId: string) =>
    `analytics:project-health:${workspaceId}`,
  analyticsMemberContribution: (workspaceId: string) =>
    `analytics:member-contribution:${workspaceId}`,
  analyticsTimeSummary: (workspaceId: string, days: number) =>
    `analytics:time-summary:${workspaceId}:${days}`,
  analyticsActivityTrends: (workspaceId: string, days: number) =>
    `analytics:activity-trends:${workspaceId}:${days}`,
  analyticsWorkload: (workspaceId: string) =>
    `analytics:workload:${workspaceId}`,

  // Storage caching
  storageWorkspacesSummary: (userId: string) =>
    `storage:summary:user:${userId}`,
  storageOverview: (workspaceId: string, userId: string) =>
    `storage:overview:${workspaceId}:${userId}`,
  storageInfo: (workspaceId: string, userId: string) =>
    `storage:info:${workspaceId}:${userId}`,
  storageMyContribution: (workspaceId: string, userId: string) =>
    `storage:my-contribution:${workspaceId}:${userId}`,
  storageUserContributions: (workspaceId: string) =>
    `storage:user-contributions:${workspaceId}`,
  storageLargestFiles: (workspaceId: string, limit: number) =>
    `storage:largest-files:${workspaceId}:${limit}`,
} as const;

// ─── Generic Cache Helpers ────────────────────────────────────────────────────

export const CacheClient = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const redis = getRedisClient();
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.error(`[Cache] Failed to get key "${key}":`, error);
      return null;
    }
  },

  async set(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      console.error(`[Cache] Failed to set key "${key}":`, error);
    }
  },

  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const redis = getRedisClient();
      await redis.del(...keys);
    } catch (error) {
      console.error(`[Cache] Failed to delete keys:`, error);
    }
  },

  async deletePattern(pattern: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const keys = await redis.keys(pattern);
      if (keys.length > 0) await redis.del(...keys);
    } catch (error) {
      console.error(`[Cache] Failed to delete pattern "${pattern}":`, error);
    }
  },

  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number,
  ): Promise<T> {
    const cached = await CacheClient.get<T>(key);
    if (cached !== null) return cached;
    const fresh = await fetcher();
    await CacheClient.set(key, fresh, ttl);
    return fresh;
  },
};

// ─── Workspace Cache Invalidation ─────────────────────────────────────────────

export const WorkspaceCache = {
  async invalidateWorkspace(workspaceId: string, slug?: string): Promise<void> {
    const keys = [
      CACHE_KEYS.workspaceById(workspaceId),
      CACHE_KEYS.workspaceStats(workspaceId),
      CACHE_KEYS.workspaceMembers(workspaceId),
    ];
    if (slug) {
      keys.push(CACHE_KEYS.workspaceBySlug(slug));
      keys.push(CACHE_KEYS.workspaceOverview(slug));
    }
    await CacheClient.delete(...keys);
    await AnalyticsCache.invalidateWorkspace(workspaceId);
  },

  async invalidateUserWorkspaces(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.userWorkspaces(userId));
  },

  async invalidateMembers(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.workspaceMembers(workspaceId));
  },
};

// ─── Label Cache Invalidation ──────────────────────────────────────────────────

export const LabelCache = {
  async invalidateLabelList(
    userId: string,
    workspaceId: string | null,
  ): Promise<void> {
    await CacheClient.delete(
      CACHE_KEYS.labelList(userId, workspaceId),
      CACHE_KEYS.popularLabels(userId, workspaceId),
    );
  },

  async invalidateLabel(labelId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.labelById(labelId));
  },

  async invalidateWorkspaceLabels(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`labels:*:*:${workspaceId}`);
  },
};

// ─── Analytics Cache Invalidation ──────────────────────────────────────────────

export const AnalyticsCache = {
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`analytics:*:${workspaceId}*`);
  },

  async invalidateOverview(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsOverview(workspaceId));
  },

  async invalidateKPIs(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsKPIs(workspaceId));
  },

  async invalidateTaskTrends(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`analytics:task-trends:${workspaceId}:*`);
  },

  async invalidateProjectHealth(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsProjectHealth(workspaceId));
  },

  async invalidateMemberContribution(workspaceId: string): Promise<void> {
    await CacheClient.delete(
      CACHE_KEYS.analyticsMemberContribution(workspaceId),
    );
  },

  async invalidateTimeSummary(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`analytics:time-summary:${workspaceId}:*`);
  },

  async invalidateActivityTrends(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(
      `analytics:activity-trends:${workspaceId}:*`,
    );
  },

  async invalidateWorkload(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsWorkload(workspaceId));
  },
};

// ─── Storage Cache Invalidation ───────────────────────────────────────────────

export const StorageCache = {
  /**
   * Full invalidation for a workspace — call after any file mutation
   * (upload, delete, bulk-delete). Wipes all per-workspace storage keys
   * and any per-user summary/contribution keys that reference this workspace.
   */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    // Pattern-based wipe covers overview, info, contributions, largest-files
    await CacheClient.deletePattern(`storage:*:${workspaceId}*`);
    await CacheClient.deletePattern(`storage:*:${workspaceId}:*`);
  },

  /**
   * Invalidate the workspaces summary for a specific user.
   * Call after any upload/delete so the summary list stays fresh.
   */
  async invalidateUserSummary(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.storageWorkspacesSummary(userId));
  },

  /**
   * Convenience: wipe everything related to a workspace AND the acting user's
   * summary in a single call. This is the most common invalidation path.
   */
  async invalidateAll(workspaceId: string, userId: string): Promise<void> {
    await Promise.all([
      StorageCache.invalidateWorkspace(workspaceId),
      StorageCache.invalidateUserSummary(userId),
    ]);
  },
};
