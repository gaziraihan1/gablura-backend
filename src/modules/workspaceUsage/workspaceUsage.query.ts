import { prisma } from "../../lib/prisma.js";
import { WorkspaceUsageAccess } from "./workspaceUsage.access.js";
import { categorizeFileType } from "../file/fileManagement.utils.js";
import {
  bytesToMB,
  daysBetween,
  getDateRange,
  getDayBounds,
  getMonthRange,
  pctChange,
  buildGrowthInsights,
} from "./workspaceUsage.utils.js";
import { PLAN_LIMITS } from "./workspaceUsage.types.js";
import type {
  WorkspaceUsageData,
  UsageSnapshot,
  FeatureUsageMetrics,
  PlanLimitsMetrics,
  ProjectActivityMetrics,
  UserEngagementMetrics,
  ResourceUsageMetrics,
  WorkspaceLoadMetrics,
  WorkspaceGrowthMetrics,
} from "./workspaceUsage.types.js";
import { CacheClient } from "../../lib/redis/cache.client.js";

// ─── Shared local types for pre-fetched data ────────────────────────────────

type FetchedMember = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    lastLoginAt: Date | null;
  };
};

type FetchedFile = {
  id: string;
  size: number;
  uploadedById: string;
  projectId: string | null;
  mimeType: string;
  uploadedAt: Date;
};

type FetchedWorkspace = {
  plan: string;
  maxStorage: number;
} | null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function nDaysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function nDaysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function totalStorageMB(files: FetchedFile[]): number {
  return bytesToMB(files.reduce((sum, f) => sum + f.size, 0));
}

const PEAK_HOUR_BUCKETS = [0, 3, 6, 9, 12, 15, 18, 21];
const PEAK_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── Query ──────────────────────────────────────────────────────────────────

export const WorkspaceUsageQuery = {
  async getWorkspaceUsage(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceUsageData> {
    const member = await WorkspaceUsageAccess.assertWorkspaceMember(
      userId,
      workspaceId,
    );
    const isAdmin = WorkspaceUsageAccess.isAdmin(member.role);

    // Check cache first
    const cacheKey = `workspace-usage:${workspaceId}`;
    const cached = await CacheClient.get<WorkspaceUsageData>(cacheKey);
    if (cached) {
      return { ...cached, isAdmin };
    }

    // ── Tier-1: base data ──
    const [workspace, members, files] = await Promise.all([
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { plan: true, maxStorage: true },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              lastLoginAt: true,
            },
          },
        },
      }),
      prisma.file.findMany({
        where: { workspaceId },
        select: {
          id: true,
          size: true,
          uploadedById: true,
          projectId: true,
          mimeType: true,
          uploadedAt: true,
        },
      }),
    ]);

    // Compute DAU once and share across snapshot + engagement.
    const dauLastWeek = await this.getDailyActiveUsers(workspaceId, 7);

    // ── Tier-2: derived metrics (all parallel) ──
    // Fetch projects once and share across getProjectActivity and getResourceUsage
    const sharedProjects = await prisma.project.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    });

    // The stored workspace.maxStorage can lag behind the plan (it is only
    // refreshed on billing webhooks), so never under-report a paid plan's
    // limit: prefer the plan's authoritative storage, but still respect
    // admin-set overrides that raise it.
    const planStorageMB =
      PLAN_LIMITS[workspace?.plan as keyof typeof PLAN_LIMITS]?.storage ?? 1024;
    const storageLimitMB =
      Math.max(workspace?.maxStorage ?? 0, planStorageMB) || 1024;

    const [
      snapshot,
      projectActivity,
      userEngagement,
      resourceUsage,
      workspaceLoad,
      workspaceGrowth,
      featureUsage,
    ] = await Promise.all([
      this.getUsageSnapshot(workspaceId, members, files, dauLastWeek),
      this.getProjectActivity(workspaceId),
      this.getUserEngagement(workspaceId, members, isAdmin, dauLastWeek),
      this.getResourceUsage(workspaceId, files, storageLimitMB, sharedProjects),
      this.getWorkspaceLoad(workspaceId, members, isAdmin),
      this.getWorkspaceGrowth(workspaceId),
      this.getFeatureUsage(workspaceId),
    ]);

    // planLimits reuses projectCount already fetched by getProjectActivity.
    const planLimits = await this.getPlanLimits(
      workspace,
      members.length,
      files,
      projectActivity.mostActive.length + projectActivity.lowActivity.length,
    );

    // Real data-driven insights — generated from live growth + storage numbers.
    const workspaceGrowthWithInsights: WorkspaceGrowthMetrics = {
      ...workspaceGrowth,
      insights: buildGrowthInsights(workspaceGrowth, resourceUsage),
    };

    const result = {
      snapshot,
      projectActivity,
      userEngagement,
      resourceUsage,
      workspaceLoad,
      workspaceGrowth: workspaceGrowthWithInsights,
      featureUsage,
      planLimits,
      isAdmin,
    };

    // Cache for 5 minutes
    await CacheClient.set(cacheKey, result, 300);

    return result;
  },

  // ── DAU ──────────────────────────────────────────────────────────────────

  async getDailyActiveUsers(
    workspaceId: string,
    days: number,
  ): Promise<Array<{ date: string; count: number }>> {
    const dateRange = getDateRange(days);
    const windowStart = new Date(dateRange[0]);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(dateRange[dateRange.length - 1]);
    windowEnd.setHours(23, 59, 59, 999);

    const activities = await prisma.activity.findMany({
      where: {
        workspaceId,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      select: { userId: true, createdAt: true },
    });

    // Build date → unique user set map in one pass.
    const dayUsersMap = new Map<string, Set<string>>();
    for (const { userId, createdAt } of activities) {
      const key = createdAt.toISOString().split("T")[0];
      let set = dayUsersMap.get(key);
      if (!set) {
        set = new Set();
        dayUsersMap.set(key, set);
      }
      set.add(userId);
    }

    return dateRange.map((date) => {
      const { start } = getDayBounds(date);
      const key = start.toISOString().split("T")[0];
      return { date: key, count: dayUsersMap.get(key)?.size ?? 0 };
    });
  },

  // ── Snapshot ─────────────────────────────────────────────────────────────

  async getUsageSnapshot(
    workspaceId: string,
    members: FetchedMember[],
    files: FetchedFile[],
    dauLastWeek: Array<{ date: string; count: number }>,
  ): Promise<UsageSnapshot> {
    const oneWeekAgo = nDaysAgo(7);

    const [totalTasks, totalProjects, totalActivities] = await Promise.all([
      prisma.task.count({ where: { workspaceId } }),
      prisma.project.count({ where: { workspaceId } }),
      prisma.activity.count({
        where: { workspaceId, createdAt: { gte: oneWeekAgo } },
      }),
    ]);

    const totalMembers = members.length;
    const activeMembers = members.filter(
      (m) => m.user.lastLoginAt && m.user.lastLoginAt >= oneWeekAgo,
    ).length;

    const storageUsedMB = totalStorageMB(files);
    const dauSum = dauLastWeek.reduce((sum, d) => sum + d.count, 0);
    const avgDailyUsers =
      dauLastWeek.length > 0 ? Math.round(dauSum / dauLastWeek.length) : 0;

    const engagementScore =
      totalMembers > 0
        ? Math.min(100, Math.round((activeMembers / totalMembers) * 100))
        : 0;

    return {
      totalMembers,
      activeMembers,
      totalTasks,
      totalProjects,
      storageUsedMB,
      activityEvents: totalActivities,
      avgDailyUsers,
      engagementScore,
    };
  },

  // ── User Engagement ───────────────────────────────────────────────────────

  async getUserEngagement(
    workspaceId: string,
    members: FetchedMember[],
    isAdmin: boolean,
    dailyActiveUsers: Array<{ date: string; count: number }>,
  ): Promise<UserEngagementMetrics> {
    if (!isAdmin) {
      return {
        activeUsers: { online: 0, thisWeek: 0, thisMonth: 0 },
        inactiveUsers: [],
        collaborationIndex: [],
        dailyActiveUsers,
        peakHours: [],
      };
    }

    const now = new Date();
    const oneWeekAgo = nDaysAgo(7);
    const oneMonthAgo = nDaysAgo(30);
    const fourteenAgo = nDaysAgo(14);

    const activeThisWeek = members.filter(
      (m) => m.user.lastLoginAt && m.user.lastLoginAt >= oneWeekAgo,
    ).length;
    const activeThisMonth = members.filter(
      (m) => m.user.lastLoginAt && m.user.lastLoginAt >= oneMonthAgo,
    ).length;

    const inactiveUsers = members
      .filter((m) => !m.user.lastLoginAt || m.user.lastLoginAt < fourteenAgo)
      .map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        image: m.user.image,
        lastActive: m.user.lastLoginAt,
        daysSinceActive: m.user.lastLoginAt
          ? Math.floor(
              (now.getTime() - m.user.lastLoginAt.getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 999,
      }))
      .sort((a, b) => b.daysSinceActive - a.daysSinceActive);

    const [commentCounts, tasksCounts, assigneeCounts, peakActivities] = await Promise.all([
      prisma.comment.groupBy({
        by: ["userId"],
        where: { task: { workspaceId } },
        _count: { userId: true },
      }),
      prisma.task.groupBy({
        by: ["createdById"],
        where: { workspaceId },
        _count: { createdById: true },
      }),
      prisma.taskAssignee.groupBy({
        by: ["userId"],
        where: { task: { workspaceId } },
        _count: { userId: true },
      }),
      // Real peak-hours data — activity grouped by weekday × hour bucket (30 days).
      prisma.activity.findMany({
        where: { workspaceId, createdAt: { gte: oneMonthAgo } },
        select: { createdAt: true },
      }),
    ]);

    const commentMap = new Map(commentCounts.map((c) => [c.userId, c._count.userId]));
    const taskMap = new Map(tasksCounts.map((t) => [t.createdById, t._count.createdById]));
    const assigneeMap = new Map(assigneeCounts.map((a) => [a.userId, a._count.userId]));

    const collaborationIndex = members
      .map((m) => {
        const commentsCount = commentMap.get(m.user.id) ?? 0;
        const tasksCreated = taskMap.get(m.user.id) ?? 0;
        const tasksAssigned = assigneeMap.get(m.user.id) ?? 0;
        return {
          userId: m.user.id,
          userName: m.user.name,
          userEmail: m.user.email,
          userImage: m.user.image,
          commentsCount,
          tasksCreated,
          tasksAssigned,
          collaborationScore: commentsCount * 3 + tasksCreated * 2 + tasksAssigned,
        };
      })
      .sort((a, b) => b.collaborationScore - a.collaborationScore);

    // Build the 7×8 heatmap: activity intensity 0-100 relative to the busiest cell.
    const bucketCounts = new Map<string, number>();
    for (const { createdAt } of peakActivities) {
      const dayIndex = (createdAt.getDay() + 6) % 7; // Monday = 0
      const bucket = PEAK_HOUR_BUCKETS[Math.floor(createdAt.getHours() / 3)] ?? 21;
      const key = `${PEAK_DAY_LABELS[dayIndex]}:${bucket}`;
      bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
    }
    const maxBucketCount = Math.max(...Array.from(bucketCounts.values()), 1);

    const peakHours = PEAK_DAY_LABELS.flatMap((day) =>
      PEAK_HOUR_BUCKETS.map((hour) => ({
        day,
        hour,
        activity: Math.round(((bucketCounts.get(`${day}:${hour}`) ?? 0) / maxBucketCount) * 100),
      })),
    );

    return {
      activeUsers: { online: 0, thisWeek: activeThisWeek, thisMonth: activeThisMonth },
      inactiveUsers,
      collaborationIndex,
      dailyActiveUsers,
      peakHours,
    };
  },

  // ── Feature Usage ─────────────────────────────────────────────────────────

  async getFeatureUsage(workspaceId: string): Promise<FeatureUsageMetrics> {
    const thirtyDaysAgo = nDaysAgo(30);

    const [
      tasksCreated,
      commentsAdded,
      timeEntriesLogged,
      filesUploaded,
      notifications,
      commentsWithMentions,
    ] = await Promise.all([
      prisma.task.count({ where: { workspaceId, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.comment.count({
        where: { task: { workspaceId }, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.timeEntry.count({
        where: { task: { workspaceId }, startedAt: { gte: thirtyDaysAgo } },
      }),
      prisma.file.count({ where: { workspaceId, uploadedAt: { gte: thirtyDaysAgo } } }),
      prisma.notification.count({
        where: {
          user: { workspaceMembers: { some: { workspaceId } } },
          createdAt: { gte: thirtyDaysAgo },
        },
      }),
      prisma.comment.findMany({
        where: {
          task: { workspaceId },
          content: { contains: "@" },
          createdAt: { gte: thirtyDaysAgo },
        },
        select: { content: true },
      }),
    ]);

    const mentionsUsed = commentsWithMentions.reduce(
      (sum, c) => sum + (c.content.match(/@\w+/g)?.length ?? 0),
      0,
    );

    return {
      tasksCreated,
      commentsAdded,
      timeEntriesLogged,
      filesUploaded,
      mentionsUsed,
      notificationsTriggered: notifications,
    };
  },

  // ── Plan Limits ───────────────────────────────────────────────────────────

  async getPlanLimits(
    workspace: FetchedWorkspace,
    memberCount: number,
    files: FetchedFile[],
    projectCount: number,
  ): Promise<PlanLimitsMetrics> {
    if (!workspace) throw new Error("Workspace not found");

    const storageUsedMB = totalStorageMB(files);
    const limits =
      PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.FREE;

    return {
      currentPlan: workspace.plan,
      memberCount,
      memberLimit: limits.members,
      storageUsedMB,
      storageLimitMB: limits.storage,
      projectCount,
      projectLimit: limits.projects,
      automationCount: 0,
      automationLimit: limits.automations,
    };
  },

  // ── Project Activity ──────────────────────────────────────────────────────

  async getProjectActivity(workspaceId: string): Promise<ProjectActivityMetrics> {
    const thirtyDaysAgo = nDaysAgo(30);

    const projects = await prisma.project.findMany({
      where: { workspaceId },
      select: {
        id: true,
        name: true,
        color: true,
        createdAt: true,
        _count: { select: { tasks: true } },
      },
    });

    if (projects.length === 0) {
      return { mostActive: [], lowActivity: [], tasksPerProjectTrend: [] };
    }

    const projectIds = projects.map((p) => p.id);

    // Run the three aggregation queries in parallel. These return taskId-based
    // results which we'll map to projectId after fetching the minimal task set.
    const [commentCounts, activityCounts, lastActivityRows] = await Promise.all([
      prisma.comment.groupBy({
        by: ["taskId"],
        where: { task: { projectId: { in: projectIds } } },
        _count: { id: true },
      }),
      prisma.activity.groupBy({
        by: ["taskId"],
        where: {
          task: { projectId: { in: projectIds } },
          createdAt: { gte: thirtyDaysAgo },
        },
        _count: { id: true },
      }),
      // Most-recent activity per project: groupBy taskId with _max createdAt,
      // instead of fetching all activity rows ordered.
      prisma.activity.groupBy({
        by: ["taskId"],
        where: { task: { projectId: { in: projectIds } } },
        _max: { createdAt: true },
      }),
    ]);

    // Collect only the taskIds referenced by the aggregation results.
    const referencedTaskIds = new Set<string>();
    for (const c of commentCounts) referencedTaskIds.add(c.taskId);
    for (const c of activityCounts) if (c.taskId) referencedTaskIds.add(c.taskId);
    for (const r of lastActivityRows) if (r.taskId) referencedTaskIds.add(r.taskId);

    // Fetch only the tasks we actually need for the taskId → projectId mapping
    // (much smaller than fetching ALL tasks in the workspace).
    const referencedTasks = referencedTaskIds.size > 0
      ? await prisma.task.findMany({
          where: { id: { in: Array.from(referencedTaskIds) } },
          select: { id: true, projectId: true },
        })
      : [];
    const taskProjectMap = new Map(referencedTasks.map((t) => [t.id, t.projectId!]));

    // Map aggregation results to projectId.
    const commentsByProject = new Map<string, number>();
    for (const c of commentCounts) {
      const projId = taskProjectMap.get(c.taskId);
      if (projId) commentsByProject.set(projId, (commentsByProject.get(projId) ?? 0) + c._count.id);
    }

    const activitiesByProject = new Map<string, number>();
    for (const c of activityCounts) {
      if (c.taskId) {
        const projId = taskProjectMap.get(c.taskId);
        if (projId) activitiesByProject.set(projId, (activitiesByProject.get(projId) ?? 0) + c._count.id);
      }
    }

    const lastActivities = new Map<string, Date>();
    for (const { taskId, _max } of lastActivityRows) {
      if (!taskId || !_max.createdAt) continue;
      const projId = taskProjectMap.get(taskId);
      if (projId && !lastActivities.has(projId)) lastActivities.set(projId, _max.createdAt);
    }

    const now = new Date();

    const projectsWithScores = projects.map((p) => {
      const commentCount = commentsByProject.get(p.id) ?? 0;
      const recentActivityCount = activitiesByProject.get(p.id) ?? 0;
      const lastActivity = lastActivities.get(p.id) ?? p.createdAt;

      return {
        id: p.id,
        name: p.name,
        color: p.color,
        activityScore: recentActivityCount * 5 + commentCount * 3 + p._count.tasks,
        taskCount: p._count.tasks,
        commentCount,
        lastActivity,
        daysSinceLastActivity: daysBetween(lastActivity, now),
      };
    });

    const mostActive = [...projectsWithScores]
      .sort((a, b) => b.activityScore - a.activityScore)
      .slice(0, 10);

    const lowActivity = projectsWithScores
      .filter((p) => p.daysSinceLastActivity >= 14)
      .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity)
      .slice(0, 10)
      .map(({ id, name, color, taskCount, daysSinceLastActivity }) => ({
        id,
        name,
        color,
        taskCount,
        daysSinceLastActivity,
      }));

    return { mostActive, lowActivity, tasksPerProjectTrend: [] };
  },

  // ── Resource Usage ────────────────────────────────────────────────────────

  async getResourceUsage(
    workspaceId: string,
    files: FetchedFile[],
    maxStorageMB: number,
    projects?: Array<{ id: string; name: string }>,
  ): Promise<ResourceUsageMetrics> {
    // Use pre-fetched projects if available (from getProjectActivity), otherwise fetch
    const projectList = projects ?? await prisma.project.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    });

    // Group files by project.
    const filesByProject = new Map<string, FetchedFile[]>();
    for (const f of files) {
      if (f.projectId) {
        const bucket = filesByProject.get(f.projectId) ?? [];
        bucket.push(f);
        filesByProject.set(f.projectId, bucket);
      }
    }

    const usedMB = totalStorageMB(files);

    const storageByProject = projectList
      .flatMap((p) => {
        const projectFiles = filesByProject.get(p.id);
        if (!projectFiles?.length) return [];
        const storageMB = bytesToMB(projectFiles.reduce((s, f) => s + f.size, 0));
        return [
          {
            projectId: p.id,
            projectName: p.name,
            storageUsedMB: storageMB,
            fileCount: projectFiles.length,
            percentage: usedMB > 0 ? Math.round((storageMB / usedMB) * 100) : 0,
          },
        ];
      })
      .sort((a, b) => b.storageUsedMB - a.storageUsedMB)
      .slice(0, 10);

    // Group files by user.
    const filesByUserId = new Map<string, FetchedFile[]>();
    for (const f of files) {
      const bucket = filesByUserId.get(f.uploadedById) ?? [];
      bucket.push(f);
      filesByUserId.set(f.uploadedById, bucket);
    }

    const userIds = Array.from(filesByUserId.keys());
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });

    const filesByUser = users
      .map((u) => {
        const userFiles = filesByUserId.get(u.id) ?? [];
        return {
          userId: u.id,
          userName: u.name,
          userEmail: u.email,
          fileCount: userFiles.length,
          storageUsedMB: bytesToMB(userFiles.reduce((s, f) => s + f.size, 0)),
        };
      })
      .filter((u) => u.fileCount > 0)
      .sort((a, b) => b.storageUsedMB - a.storageUsedMB);

    // ── Real storage growth + file trends (last 6 months) ──
    const monthRanges = getMonthRange(6);

    let cumulativeStorage = 0;
    const storageGrowth = monthRanges.map(({ start, end, label }) => {
      const monthBytes = files
        .filter((f) => f.uploadedAt >= start && f.uploadedAt <= end)
        .reduce((sum, f) => sum + f.size, 0);
      cumulativeStorage += monthBytes;
      return { month: label, storage: bytesToMB(cumulativeStorage) };
    });

    const fileTrend = monthRanges.map(({ start, end, label }) => ({
      month: label,
      count: files.filter((f) => f.uploadedAt >= start && f.uploadedAt <= end).length,
    }));

    const fileGrowthPct = pctChange(
      fileTrend[fileTrend.length - 2]?.count ?? 0,
      fileTrend[fileTrend.length - 1]?.count ?? 0,
    );

    // ── Real file-type distribution from mimeType ──
    const typeCounts = new Map<string, number>();
    for (const f of files) {
      const category = categorizeFileType(f.mimeType);
      typeCounts.set(category, (typeCounts.get(category) ?? 0) + 1);
    }
    const fileTypeDistribution = Array.from(typeCounts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    return {
      storageByProject,
      filesByUser,
      totalStorage: {
        usedMB,
        totalMB: maxStorageMB,
        percentage: Math.min(100, Math.round((usedMB / maxStorageMB) * 100)),
      },
      storageGrowth,
      fileTrend,
      fileGrowthPct,
      fileTypeDistribution,
    };
  },

  // ── Workspace Load ────────────────────────────────────────────────────────

  async getWorkspaceLoad(
    workspaceId: string,
    members: FetchedMember[],
    isAdmin: boolean,
  ): Promise<WorkspaceLoadMetrics> {
    if (!isAdmin) {
      return {
        tasksPerUser: [],
        projectsNearingDeadlines: [],
        averageTaskCompletion: { byUser: [], byProject: [] },
      };
    }

    const now = new Date();
    const fourteenDaysOut = nDaysFromNow(14);

    const [assigneeCounts, overdueTaskCounts, nearingProjects] = await Promise.all([
      prisma.taskAssignee.groupBy({
        by: ["userId"],
        where: {
          task: { workspaceId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
        },
        _count: { userId: true },
      }),
      prisma.taskAssignee.groupBy({
        by: ["userId"],
        where: {
          task: {
            workspaceId,
            status: { notIn: ["COMPLETED", "CANCELLED"] },
            dueDate: { lt: now },
          },
        },
        _count: { userId: true },
      }),
      prisma.project.findMany({
        where: {
          workspaceId,
          dueDate: { gte: now, lte: fourteenDaysOut },
          status: { notIn: ["COMPLETED", "ARCHIVED"] },
        },
        include: { tasks: { select: { id: true, status: true } } },
      }),
    ]);

    const assigneeMap = new Map(assigneeCounts.map((a) => [a.userId, a._count.userId]));
    const overdueMap = new Map(overdueTaskCounts.map((a) => [a.userId, a._count.userId]));

    const tasksPerUser = members
      .map((m) => {
        const activeTasks = assigneeMap.get(m.user.id) ?? 0;
        const overdueTasks = overdueMap.get(m.user.id) ?? 0;
        const capacityLevel: WorkspaceLoadMetrics["tasksPerUser"][0]["capacityLevel"] =
          activeTasks === 0
            ? "UNDERUTILIZED"
            : activeTasks <= 5
              ? "OPTIMAL"
              : activeTasks <= 10
                ? "NEAR_CAPACITY"
                : "OVERLOADED";

        return {
          userId: m.user.id,
          userName: m.user.name,
          userEmail: m.user.email,
          userImage: m.user.image,
          activeTasks,
          overdueTasks,
          capacityLevel,
        };
      })
      .sort((a, b) => b.activeTasks - a.activeTasks);

    const projectsNearingDeadlines = nearingProjects
      .map((p) => {
        const total = p.tasks.length;
        const completed = p.tasks.filter((t) => t.status === "COMPLETED").length;
        return {
          projectId: p.id,
          projectName: p.name,
          dueDate: p.dueDate!,
          daysRemaining: Math.ceil(
            (p.dueDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          ),
          completionPercentage: total > 0 ? Math.round((completed / total) * 100) : 0,
          status: p.status,
        };
      })
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    return {
      tasksPerUser,
      projectsNearingDeadlines,
      averageTaskCompletion: { byUser: [], byProject: [] },
    };
  },

  // ── Workspace Growth ──────────────────────────────────────────────────────

  async getWorkspaceGrowth(workspaceId: string): Promise<WorkspaceGrowthMetrics> {
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthRanges = getMonthRange(6);
    const trendWindowStart = monthRanges[0]?.start ?? firstDayOfMonth;
    const trendWindowEnd = monthRanges[monthRanges.length - 1]?.end ?? now;

    const [newUsers, newProjects, newTasks, memberRows, projectRows, taskRows, lifecycleRows] =
      await Promise.all([
        prisma.workspaceMember.count({
          where: { workspaceId, joinedAt: { gte: firstDayOfMonth } },
        }),
        prisma.project.count({
          where: { workspaceId, createdAt: { gte: firstDayOfMonth } },
        }),
        prisma.task.count({
          where: { workspaceId, createdAt: { gte: firstDayOfMonth } },
        }),
        prisma.workspaceMember.findMany({
          where: {
            workspaceId,
            joinedAt: { gte: trendWindowStart, lte: trendWindowEnd },
          },
          select: { joinedAt: true },
        }),
        prisma.project.findMany({
          where: {
            workspaceId,
            createdAt: { gte: trendWindowStart, lte: trendWindowEnd },
          },
          select: { createdAt: true },
        }),
        prisma.task.findMany({
          where: {
            workspaceId,
            createdAt: { gte: trendWindowStart, lte: trendWindowEnd },
          },
          select: { createdAt: true },
        }),
        prisma.project.groupBy({
          by: ["status"],
          where: {
            workspaceId,
            status: { in: ["ACTIVE", "COMPLETED", "ARCHIVED"] },
          },
          _count: { status: true },
        }),
      ]);

    const trend = monthRanges.map(({ start, end, label }) => ({
      month: label,
      users: memberRows.filter((r) => r.joinedAt >= start && r.joinedAt <= end).length,
      projects: projectRows.filter((r) => r.createdAt >= start && r.createdAt <= end).length,
      tasks: taskRows.filter((r) => r.createdAt >= start && r.createdAt <= end).length,
    }));

    const lifecycleMap = new Map(lifecycleRows.map((r) => [r.status, r._count.status]));

    // Real month-over-month % change (null when the previous month has no baseline).
    const prevTrend = trend[trend.length - 2];
    const changes = {
      newTasks: pctChange(prevTrend?.tasks ?? 0, newTasks),
      newUsers: pctChange(prevTrend?.users ?? 0, newUsers),
      newProjects: pctChange(prevTrend?.projects ?? 0, newProjects),
    };

    return {
      thisMonth: { newUsers, newProjects, newTasks },
      trend,
      projectLifecycle: {
        created: newProjects,
        active: lifecycleMap.get("ACTIVE") ?? 0,
        completed: lifecycleMap.get("COMPLETED") ?? 0,
        archived: lifecycleMap.get("ARCHIVED") ?? 0,
      },
      changes,
      insights: [],
    };
  },
};
