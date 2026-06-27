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

  // Project — moderate TTLs as projects change less frequently than tasks
  PROJECT_METADATA: parseInt(process.env.CACHE_TTL_PROJECT_METADATA ?? "1800"), // 30 min
  PROJECT_LIST: parseInt(process.env.CACHE_TTL_PROJECT_LIST ?? "600"), // 10 min
  PROJECT_STATS: parseInt(process.env.CACHE_TTL_PROJECT_STATS ?? "900"), // 15 min

  // Task — shorter TTLs as tasks change frequently
  TASK_METADATA: parseInt(process.env.CACHE_TTL_TASK_METADATA ?? "300"), // 5 min
  TASK_OVERVIEW: parseInt(process.env.CACHE_TTL_TASK_OVERVIEW ?? "300"), // 5 min
  TASK_STATS: parseInt(process.env.CACHE_TTL_TASK_STATS ?? "120"), // 2 min

  // Activity — very short TTLs as activities are real-time
  ACTIVITY_LIST: parseInt(process.env.CACHE_TTL_ACTIVITY_LIST ?? "60"), // 1 min
  ACTIVITY_FEED: parseInt(process.env.CACHE_TTL_ACTIVITY_FEED ?? "30"), // 30 sec

  // Calendar — moderate TTLs as calendar data changes periodically
  CALENDAR_AGGREGATES: parseInt(process.env.CACHE_TTL_CALENDAR_AGGREGATES ?? "300"), // 5 min
  CALENDAR_INSIGHTS: parseInt(process.env.CACHE_TTL_CALENDAR_INSIGHTS ?? "300"), // 5 min
  CALENDAR_SYSTEM_EVENTS: parseInt(process.env.CACHE_TTL_CALENDAR_SYSTEM_EVENTS ?? "600"), // 10 min
  CALENDAR_GOAL_CHECKPOINTS: parseInt(process.env.CACHE_TTL_CALENDAR_GOAL_CHECKPOINTS ?? "300"), // 5 min

  // Focus Session — TTLs based on data freshness needs
  FOCUS_ACTIVE_SESSION: parseInt(process.env.CACHE_TTL_FOCUS_ACTIVE_SESSION ?? "30"), // 30 sec (real-time)
  FOCUS_SESSION_HISTORY: parseInt(process.env.CACHE_TTL_FOCUS_SESSION_HISTORY ?? "300"), // 5 min
  FOCUS_SESSION_STATS: parseInt(process.env.CACHE_TTL_FOCUS_SESSION_STATS ?? "300"), // 5 min
  FOCUS_SESSION_STREAK: parseInt(process.env.CACHE_TTL_FOCUS_SESSION_STREAK ?? "600"), // 10 min

  // Analytics — moderate to long TTLs as analytics are expensive to compute
  ANALYTICS_KPI: parseInt(process.env.CACHE_TTL_ANALYTICS_KPI ?? "1800"), // 30 min
  ANALYTICS_TREND: parseInt(process.env.CACHE_TTL_ANALYTICS_TREND ?? "900"), // 15 min
  ANALYTICS_MEMBER_METRICS: parseInt(process.env.CACHE_TTL_ANALYTICS_MEMBER_METRICS ?? "600"), // 10 min
  ANALYTICS_PROJECT_HEALTH: parseInt(process.env.CACHE_TTL_ANALYTICS_PROJECT_HEALTH ?? "900"), // 15 min
  ANALYTICS_RISK_ANALYSIS: parseInt(process.env.CACHE_TTL_ANALYTICS_RISK_ANALYSIS ?? "300"), // 5 min
  ANALYTICS_DISTRIBUTION: parseInt(process.env.CACHE_TTL_ANALYTICS_DISTRIBUTION ?? "1800"), // 30 min

  // User — moderate TTLs as user data changes infrequently
  USER_PROFILE: parseInt(process.env.CACHE_TTL_USER_PROFILE ?? "1800"), // 30 min
  USER_SETTINGS: parseInt(process.env.CACHE_TTL_USER_SETTINGS ?? "3600"), // 1 hour
  USER_PERMISSIONS: parseInt(process.env.CACHE_TTL_USER_PERMISSIONS ?? "600"), // 10 min

  // Authentication — shorter TTLs for security
  AUTH_RESULT: parseInt(process.env.CACHE_TTL_AUTH_RESULT ?? "300"), // 5 min
  USER_SESSION: parseInt(process.env.CACHE_TTL_USER_SESSION ?? "3600"), // 1 hour
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
  analyticsOverdueTrend: (workspaceId: string, days: number) =>
    `analytics:overdue-trend:${workspaceId}:${days}`,
  analyticsProjectHealth: (workspaceId: string) =>
    `analytics:project-health:${workspaceId}`,
  analyticsProjectStatusDistribution: (workspaceId: string) =>
    `analytics:project-status-dist:${workspaceId}`,
  analyticsMemberContribution: (workspaceId: string) =>
    `analytics:member-contribution:${workspaceId}`,
  analyticsTimeSummary: (workspaceId: string, days: number) =>
    `analytics:time-summary:${workspaceId}:${days}`,
  analyticsActivityTrends: (workspaceId: string, days: number) =>
    `analytics:activity-trends:${workspaceId}:${days}`,
  analyticsMostActiveDay: (workspaceId: string) =>
    `analytics:most-active-day:${workspaceId}`,
  analyticsWorkload: (workspaceId: string) =>
    `analytics:workload:${workspaceId}`,
  analyticsTaskPriorityDistribution: (workspaceId: string) =>
    `analytics:task-priority-dist:${workspaceId}`,
  analyticsTaskStatusDistribution: (workspaceId: string) =>
    `analytics:task-status-dist:${workspaceId}`,
  analyticsDeadlineRisk: (workspaceId: string) =>
    `analytics:deadline-risk:${workspaceId}`,

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

  // Project caching
  projectById: (projectId: string) => `project:id:${projectId}`,
  projectBySlug: (slug: string) => `project:slug:${slug}`,
  projectList: (userId: string, workspaceId?: string) =>
    `project:list:${userId}:${workspaceId ?? "all"}`,
  projectStats: (projectId: string) => `project:stats:${projectId}`,
  projectWorkspaceList: (workspaceId: string) =>
    `project:workspace:${workspaceId}`,

  // Task caching
  taskById: (taskId: string) => `task:id:${taskId}`,
  taskOverview: (taskId: string) => `task:overview:${taskId}`,
  taskStats: (userId: string, workspaceId?: string, type?: string) =>
    `task:stats:${userId}:${workspaceId ?? "personal"}:${type ?? "all"}`,

  // Activity caching
  activityUserList: (userId: string, workspaceId?: string) =>
    `activity:user:${userId}:${workspaceId ?? "all"}`,
  activityWorkspaceList: (workspaceId: string) => `activity:workspace:${workspaceId}`,
  activityTaskList: (taskId: string) => `activity:task:${taskId}`,

  // Calendar caching
  calendarAggregates: (userId: string, workspaceId: string | undefined, startDate: string, endDate: string) =>
    `calendar:aggregates:${userId}:${workspaceId ?? "all"}:${startDate}:${endDate}`,
  calendarInsights: (userId: string, workspaceId: string | undefined, startDate: string, endDate: string) =>
    `calendar:insights:${userId}:${workspaceId ?? "all"}:${startDate}:${endDate}`,
  calendarSystemEvents: (userId: string, workspaceId: string | undefined, startDate: string, endDate: string) =>
    `calendar:system-events:${userId}:${workspaceId ?? "all"}:${startDate}:${endDate}`,
  calendarGoalCheckpoints: (userId: string, workspaceId: string | undefined, startDate: string, endDate: string) =>
    `calendar:goal-checkpoints:${userId}:${workspaceId ?? "all"}:${startDate}:${endDate}`,

  // Focus Session caching
  focusActiveSession: (userId: string) => `focus:active-session:${userId}`,
  focusSessionHistory: (userId: string, limit: number) => `focus:history:${userId}:${limit}`,
  focusSessionStats: (userId: string, startDate?: string, endDate?: string) =>
    `focus:stats:${userId}:${startDate ?? "all"}:${endDate ?? "all"}`,
  focusSessionStreak: (userId: string) => `focus:streak:${userId}`,

  // User caching
  userProfile: (userId: string) => `user:profile:${userId}`,
  userSettings: (userId: string) => `user:settings:${userId}`,
  userPermissions: (userId: string, workspaceId: string) => `user:permissions:${userId}:${workspaceId}`,

  // Authentication caching
  authResult: (tokenJti: string) => `auth:result:${tokenJti}`,
  userSession: (userId: string) => `session:user:${userId}`,
  activeSessions: (userId: string) => `sessions:active:${userId}`,
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

  /**
   * Invalidate distribution caches for a workspace
   */
  async invalidateDistributions(workspaceId: string): Promise<void> {
    await Promise.all([
      CacheClient.delete(CACHE_KEYS.analyticsProjectStatusDistribution(workspaceId)),
      CacheClient.delete(CACHE_KEYS.analyticsTaskStatusDistribution(workspaceId)),
      CacheClient.delete(CACHE_KEYS.analyticsTaskPriorityDistribution(workspaceId)),
    ]);
  },

  /**
   * Invalidate activity caches for a workspace
   */
  async invalidateActivityMetrics(workspaceId: string): Promise<void> {
    await Promise.all([
      CacheClient.deletePattern(`analytics:activity-trends:${workspaceId}:*`),
      CacheClient.delete(CACHE_KEYS.analyticsMostActiveDay(workspaceId)),
    ]);
  },

  /**
   * Invalidate risk analysis cache for a workspace
   */
  async invalidateRiskAnalysis(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.analyticsDeadlineRisk(workspaceId));
  },

  /**
   * Invalidate overdue trend cache for a workspace
   */
  async invalidateOverdueTrend(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`analytics:overdue-trend:${workspaceId}:*`);
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

// ─── Project Cache Invalidation ────────────────────────────────────────────────

export const ProjectCache = {
  /**
   * Invalidate a specific project's metadata
   */
  async invalidateProject(projectId: string, slug?: string): Promise<void> {
    const keys = [
      CACHE_KEYS.projectById(projectId),
      CACHE_KEYS.projectStats(projectId),
    ];
    if (slug) {
      keys.push(CACHE_KEYS.projectBySlug(slug));
    }
    await CacheClient.delete(...keys);
  },

  /**
   * Invalidate all project lists for a specific user
   */
  async invalidateUserProjects(userId: string): Promise<void> {
    await CacheClient.deletePattern(`project:list:${userId}:*`);
  },

  /**
   * Invalidate all projects in a workspace
   */
  async invalidateWorkspaceProjects(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.projectWorkspaceList(workspaceId));
    await CacheClient.deletePattern(`project:list:*:${workspaceId}`);
  },
};

// ─── Task Cache Invalidation ────────────────────────────────────────────────────

export const TaskCache = {
  /**
   * Invalidate a specific task's metadata
   */
  async invalidateTask(taskId: string): Promise<void> {
    await CacheClient.delete(
      CACHE_KEYS.taskById(taskId),
      CACHE_KEYS.taskOverview(taskId),
    );
  },

  /**
   * Invalidate task stats for a user/workspace context
   */
  async invalidateTaskStats(userId: string, workspaceId?: string): Promise<void> {
    await CacheClient.deletePattern(`task:stats:${userId}:${workspaceId ?? 'personal'}:*`);
  },

  /**
   * Invalidate all task-related caches for a workspace
   */
  async invalidateWorkspaceTasks(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`task:stats:*:${workspaceId}:*`);
  },
};

// ─── Activity Cache Invalidation ─────────────────────────────────────────────────

export const ActivityCache = {
  /**
   * Invalidate user activity lists
   */
  async invalidateUserActivities(userId: string, workspaceId?: string): Promise<void> {
    await CacheClient.deletePattern(`activity:user:${userId}:*`);
  },

  /**
   * Invalidate workspace activity feed
   */
  async invalidateWorkspaceActivities(workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.activityWorkspaceList(workspaceId));
  },

  /**
   * Invalidate task activity timeline
   */
  async invalidateTaskActivities(taskId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.activityTaskList(taskId));
  },
};

// ─── Calendar Cache Invalidation ─────────────────────────────────────────────────

export const CalendarCache = {
  /**
   * Invalidate calendar aggregates for a user/workspace date range
   */
  async invalidateAggregates(userId: string, workspaceId?: string): Promise<void> {
    await CacheClient.deletePattern(`calendar:aggregates:${userId}:*`);
  },

  /**
   * Invalidate calendar insights for a user/workspace date range
   */
  async invalidateInsights(userId: string, workspaceId?: string): Promise<void> {
    await CacheClient.deletePattern(`calendar:insights:${userId}:*`);
  },

  /**
   * Invalidate system events for a user/workspace date range
   */
  async invalidateSystemEvents(userId: string, workspaceId?: string): Promise<void> {
    await CacheClient.deletePattern(`calendar:system-events:${userId}:*`);
  },

  /**
   * Invalidate goal checkpoints for a user/workspace date range
   */
  async invalidateGoalCheckpoints(userId: string, workspaceId?: string): Promise<void> {
    await CacheClient.deletePattern(`calendar:goal-checkpoints:${userId}:*`);
  },

  /**
   * Invalidate all calendar data for a user
   */
  async invalidateUserCalendar(userId: string): Promise<void> {
    await CacheClient.deletePattern(`calendar:*:${userId}:*`);
  },

  /**
   * Invalidate all calendar data for a workspace
   */
  async invalidateWorkspaceCalendar(workspaceId: string): Promise<void> {
    await CacheClient.deletePattern(`calendar:*:*:${workspaceId}:*`);
  },
};

// ─── Focus Session Cache Invalidation ─────────────────────────────────────────────

export const FocusSessionCache = {
  /**
   * Invalidate active session cache for a user
   */
  async invalidateActiveSession(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.focusActiveSession(userId));
  },

  /**
   * Invalidate session history cache for a user
   */
  async invalidateHistory(userId: string): Promise<void> {
    await CacheClient.deletePattern(`focus:history:${userId}:*`);
  },

  /**
   * Invalidate session stats cache for a user
   */
  async invalidateStats(userId: string): Promise<void> {
    await CacheClient.deletePattern(`focus:stats:${userId}:*`);
  },

  /**
   * Invalidate focus streak cache for a user
   */
  async invalidateStreak(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.focusSessionStreak(userId));
  },

  /**
   * Invalidate all focus session caches for a user
   */
  async invalidateUserFocusSessions(userId: string): Promise<void> {
    await Promise.all([
      this.invalidateActiveSession(userId),
      this.invalidateHistory(userId),
      this.invalidateStats(userId),
      this.invalidateStreak(userId),
    ]);
  },
};

// ─── User Cache Invalidation ─────────────────────────────────────────────────────

export const UserCache = {
  /**
   * Invalidate user profile cache
   */
  async invalidateProfile(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.userProfile(userId));
  },

  /**
   * Invalidate user settings cache
   */
  async invalidateSettings(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.userSettings(userId));
  },

  /**
   * Invalidate user permissions for a specific workspace
   */
  async invalidatePermissions(userId: string, workspaceId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.userPermissions(userId, workspaceId));
  },

  /**
   * Invalidate all user permissions across all workspaces
   */
  async invalidateAllPermissions(userId: string): Promise<void> {
    await CacheClient.deletePattern(`user:permissions:${userId}:*`);
  },

  /**
   * Invalidate all user-related caches (profile, settings, permissions)
   */
  async invalidateUser(userId: string): Promise<void> {
    await Promise.all([
      this.invalidateProfile(userId),
      this.invalidateSettings(userId),
      this.invalidateAllPermissions(userId),
    ]);
  },

  /**
   * Invalidate user session cache
   */
  async invalidateSession(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.userSession(userId));
  },

  /**
   * Invalidate active sessions cache for a user
   */
  async invalidateActiveSessions(userId: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.activeSessions(userId));
  },

  /**
   * Invalidate authentication result cache for a specific token
   */
  async invalidateAuthResult(tokenJti: string): Promise<void> {
    await CacheClient.delete(CACHE_KEYS.authResult(tokenJti));
  },
};
