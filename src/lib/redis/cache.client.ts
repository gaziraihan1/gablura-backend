
// ─── Cache TTL Configuration (in seconds) ─────────────────────────────────────
// These values can be overridden via environment variables

import { getRedisClient } from "../../redis/redis.client.js";

export const CACHE_TTL = {
  WORKSPACE_METADATA: parseInt(process.env.CACHE_TTL_WORKSPACE_METADATA ?? "3600"), // 1 hour
  LABEL_LIST: parseInt(process.env.CACHE_TTL_LABEL_LIST ?? "1800"), // 30 minutes
  ANALYTICS_DASHBOARD: parseInt(process.env.CACHE_TTL_ANALYTICS ?? "3600"), // 1 hour
  WORKSPACE_OVERVIEW: parseInt(process.env.CACHE_TTL_WORKSPACE_OVERVIEW ?? "3600"), // 1 hour
  WORKSPACE_STATS: parseInt(process.env.CACHE_TTL_WORKSPACE_STATS ?? "1800"), // 30 minutes
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
  analyticsOverview: (workspaceId: string) => `analytics:overview:${workspaceId}`,
  analyticsKPIs: (workspaceId: string) => `analytics:kpis:${workspaceId}`,
  analyticsTaskTrends: (workspaceId: string, days: number) =>
    `analytics:task-trends:${workspaceId}:${days}`,
  analyticsProjectHealth: (workspaceId: string) => `analytics:project-health:${workspaceId}`,
  analyticsMemberContribution: (workspaceId: string) =>
    `analytics:member-contribution:${workspaceId}`,
  analyticsTimeSummary: (workspaceId: string, days: number) =>
    `analytics:time-summary:${workspaceId}:${days}`,
  analyticsActivityTrends: (workspaceId: string, days: number) =>
    `analytics:activity-trends:${workspaceId}:${days}`,
  analyticsWorkload: (workspaceId: string) => `analytics:workload:${workspaceId}`,
} as const;

// ─── Generic Cache Helpers ────────────────────────────────────────────────────

export const CacheClient = {
  /**
   * Get a cached value by key
   */
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

  /**
   * Set a cached value with TTL
   */
  async set(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      const redis = getRedisClient();
      const payload = JSON.stringify(value);
      if (typeof (redis as any).setex === "function") {
        await (redis as any).setex(key, ttl, payload);
        return;
      }
      if (typeof (redis as any).set === "function") {
        await (redis as any).set(key, payload, "EX", ttl);
      }
    } catch (error) {
      console.error(`[Cache] Failed to set key "${key}":`, error);
    }
  },

  /**
   * Delete one or more cache keys
   */
  async delete(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      const redis = getRedisClient();
      await redis.del(...keys);
    } catch (error) {
      console.error(`[Cache] Failed to delete keys:`, error);
    }
  },

  /**
   * Delete all keys matching a pattern (use with caution)
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      const redis = getRedisClient();
      if (typeof (redis as any).keys !== "function") {
        return;
      }
      const keys = await (redis as any).keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.error(`[Cache] Failed to delete pattern "${pattern}":`, error);
    }
  },

  /**
   * Generic cache-aside pattern helper
   * Attempts to get from cache, falls back to fetcher, then caches result
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number,
  ): Promise<T> {
    const cached = await CacheClient.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const fresh = await fetcher();
    await CacheClient.set(key, fresh, ttl);
    return fresh;
  },
};

// ─── Workspace Cache Invalidation ─────────────────────────────────────────────

export const WorkspaceCache = {
  /**
   * Invalidate all cache related to a specific workspace
   * Called when workspace is updated, deleted, or member changes occur
   */
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

    // Also invalidate analytics for this workspace
    await AnalyticsCache.invalidateWorkspace(workspaceId);
  },

  /**
   * Invalidate user's workspace list
   * Called when user joins/leaves a workspace or workspace is created/deleted
   */
  async invalidateUserWorkspaces(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.userWorkspaces(userId));
  },

  /**
   * Invalidate workspace members cache
   * Called when members are added, removed, or roles changed
   */
  async invalidateMembers(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.workspaceMembers(workspaceId));
  },
};

// ─── Label Cache Invalidation ──────────────────────────────────────────────────

export const LabelCache = {
  /**
   * Invalidate label list cache for a user
   * Called when labels are created, updated, or deleted
   */
  async invalidateLabelList(userId: string, workspaceId: string | null): Promise<void> {
    const keys = [
      CACHE_KEYS.labelList(userId, workspaceId),
      CACHE_KEYS.popularLabels(userId, workspaceId),
    ];
    await CacheClient.delete(...keys);
  },

  /**
   * Invalidate a specific label
   * Called when a label is updated or deleted
   */
  async invalidateLabel(labelId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.labelById(labelId));
  },

  /**
   * Invalidate all label caches for a workspace
   * Called when workspace data changes that might affect labels
   */
  async invalidateWorkspaceLabels(workspaceId: string): Promise<void> {
    // Delete all label cache keys for this workspace
    await CacheClient.deletePattern(`labels:*:*:${workspaceId}`);
  },
};

// ─── Analytics Cache Invalidation ──────────────────────────────────────────────

export const AnalyticsCache = {
  /**
   * Invalidate all analytics cache for a workspace
   * Called when tasks, projects, members, or time entries change
   */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`analytics:*:${workspaceId}*`);
  },

  /**
   * Invalidate specific analytics cache
   */
  async invalidateOverview(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsOverview(workspaceId));
  },

  async invalidateKPIs(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsKPIs(workspaceId));
  },

  async invalidateTaskTrends(workspaceId: string): Promise<void> {
    // Invalidate all task trend caches for this workspace (all day ranges)
    await CacheClient.deletePattern(`analytics:task-trends:${workspaceId}:*`);
  },

  async invalidateProjectHealth(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsProjectHealth(workspaceId));
  },

  async invalidateMemberContribution(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsMemberContribution(workspaceId));
  },

  async invalidateTimeSummary(workspaceId: string): Promise<void> {
    // Invalidate all time summary caches for this workspace (all day ranges)
    await CacheClient.deletePattern(`analytics:time-summary:${workspaceId}:*`);
  },

  async invalidateActivityTrends(workspaceId: string): Promise<void> {
    // Invalidate all activity trend caches for this workspace (all day ranges)
    await CacheClient.deletePattern(`analytics:activity-trends:${workspaceId}:*`);
  },

  async invalidateWorkload(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsWorkload(workspaceId));
  },
};