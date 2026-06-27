import { prisma } from "../../lib/prisma.js";
import { AnalyticsAccess } from "./analytics.access.js";
import {
  minutesToHours,
  bytesToMB,
  getDayKey,
  getWeekOfDay,
} from "./analytics.utils.js";
import type {
  ExecutiveKPIs,
  TaskStatusDistribution,
  TrendDataPoint,
  OverdueTrendPoint,
  ProjectHealth,
  MemberContribution,
  TimeTrackingSummary,
  ActivityVolumePoint,
  MostActiveDay,
  MemberWorkload,
  DeadlineRiskAnalysis,
} from "./analytics.types.js";
import { CacheClient, CACHE_KEYS, CACHE_TTL, AnalyticsCache } from "../../lib/redis/cache.client.js";
import { Prisma, TaskStatus } from "@prisma/client";

export const AnalyticsQuery = {

  async getExecutiveKPIs(
    workspaceId: string,
    userId: string,
  ): Promise<ExecutiveKPIs> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsKPIs(workspaceId);
    const cached = await CacheClient.get<ExecutiveKPIs>(cacheKey);
    if (cached) return cached;

    const [
      totalProjects,
      activeProjects,
      totalTasks,
      completedTasks,
      overdueTasks,
      totalMembers,
      activeMembers,
      totalHours,
      storageUsed,
    ] = await Promise.all([
      prisma.project.count({ where: { workspaceId } }),
      prisma.project.count({ where: { workspaceId, status: "ACTIVE" } }),
      prisma.task.count({ where: { workspaceId } }),
      prisma.task.count({ where: { workspaceId, status: "COMPLETED" } }),
      prisma.task.count({
        where: {
          workspaceId,
          status:  { in: ["TODO", "IN_PROGRESS"] },
          dueDate: { lt: new Date() },
        },
      }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.activity
        .groupBy({
          by:    ["userId"],
          where: {
            workspaceId,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        })
        .then((groups) => groups.length),
      prisma.timeEntry
        .aggregate({
          where: { task: { workspaceId } },
          _sum:  { duration: true },
        })
        .then((result) => minutesToHours(result._sum.duration)),
      prisma.file
        .aggregate({
          where: { workspaceId },
          _sum:  { size: true },
        })
        .then((result) => bytesToMB(result._sum.size)),
    ]);

    const completionRate =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const kpis: ExecutiveKPIs = {
      totalProjects,
      activeProjects,
      totalTasks,
      completedTasks,
      overdueTasks,
      completionRate,
      totalMembers,
      activeMembers,
      totalHours,
      storageUsed,
    };

    await CacheClient.set(cacheKey, kpis, CACHE_TTL.ANALYTICS_KPI);

    return kpis;
  },

  async getTaskStatusDistribution(
    workspaceId: string,
    userId: string,
  ): Promise<TaskStatusDistribution[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsTaskStatusDistribution(workspaceId);
    const cached = await CacheClient.get<TaskStatusDistribution[]>(cacheKey);
    if (cached) return cached;

    const distribution = await prisma.task.groupBy({
      by:     ["status"],
      where:  { workspaceId },
      _count: { status: true },
    });

    const total = distribution.reduce((sum, item) => sum + item._count.status, 0);

    const result = distribution.map((item) => ({
      status:     item.status,
      count:      item._count.status,
      percentage: total > 0 ? Math.round((item._count.status / total) * 100) : 0,
    }));

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_DISTRIBUTION);

    return result;
  },

  async getTaskCompletionTrend(
    workspaceId: string,
    userId: string,
    days: number = 30,
  ): Promise<TrendDataPoint[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsTaskTrends(workspaceId, days);
    const cached = await CacheClient.get<TrendDataPoint[]>(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Single GROUP BY — zero rows hydrated into Node memory
    const rows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
      SELECT
        DATE_TRUNC('day', "completedAt") AS day,
        COUNT(*)                         AS count
      FROM   "Task"
      WHERE  "workspaceId" = ${workspaceId}
        AND  status        = 'COMPLETED'
        AND  "completedAt" >= ${startDate}
      GROUP  BY DATE_TRUNC('day', "completedAt")
      ORDER  BY day ASC
    `;

    // O(1) Map lookup when filling the dense daily array
    const dbMap = new Map<string, number>(
      rows.map((r) => [getDayKey(r.day), Number(r.count)]),
    );

    const trend: TrendDataPoint[] = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const key = getDayKey(date);
      trend.push({ date: new Date(date), count: dbMap.get(key) ?? 0 });
    }

    await CacheClient.set(cacheKey, trend, CACHE_TTL.ANALYTICS_TREND);

    return trend;
  },

  async getOverdueTrend(
    workspaceId: string,
    userId: string,
    days: number = 30,
  ): Promise<OverdueTrendPoint[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsOverdueTrend(workspaceId, days);
    const cached = await CacheClient.get<OverdueTrendPoint[]>(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const now = new Date();

    // Single GROUP BY — consistent with getTaskCompletionTrend.
    // Pushes the week-bucketing into Postgres; zero task rows in Node memory.
    const rows = await prisma.$queryRaw<{ week_start: Date; count: bigint }[]>`
      SELECT
        DATE_TRUNC('week', "dueDate") AS week_start,
        COUNT(*)                       AS count
      FROM   "Task"
      WHERE  "workspaceId" = ${workspaceId}
        AND  status        IN ('TODO', 'IN_PROGRESS', 'BLOCKED')
        AND  "dueDate"     >= ${startDate}
        AND  "dueDate"     <  ${now}
      GROUP  BY DATE_TRUNC('week', "dueDate")
      ORDER  BY week_start ASC
    `;

    // Index DB results for O(1) lookup when filling the dense weekly array
    const dbMap = new Map<string, number>(
      rows.map((r) => [getDayKey(r.week_start), Number(r.count)]),
    );

    const weeks = Math.ceil(days / 7);
    const trend: OverdueTrendPoint[] = [];
    for (let i = 0; i < weeks; i++) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + i * 7);
      const key = getDayKey(weekStart);
      trend.push({ weekStart, count: dbMap.get(key) ?? 0 });
    }

    await CacheClient.set(cacheKey, trend, CACHE_TTL.ANALYTICS_TREND);

    return trend;
  },

  async getProjectHealthMetrics(
    workspaceId: string,
    userId: string,
  ): Promise<ProjectHealth[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsProjectHealth(workspaceId);
    const cached = await CacheClient.get<ProjectHealth[]>(cacheKey);
    if (cached) return cached;

    const projects = await prisma.project.findMany({
      where:   { workspaceId },
      include: {
        _count: { select: { tasks: true } },
        tasks:  { where: { status: "COMPLETED" }, select: { id: true } },
      },
    });

    const result = projects.map((project) => {
      const totalTasks     = project._count.tasks;
      const completedTasks = project.tasks.length;
      const progress       = totalTasks > 0
        ? Math.round((completedTasks / totalTasks) * 100)
        : 0;

      let health: "healthy" | "at-risk" | "critical" = "healthy";
      if (project.dueDate) {
        const daysUntilDue = Math.ceil(
          (project.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
        );
        if (daysUntilDue < 0) {
          health = "critical";
        } else if (daysUntilDue <= 7 && progress < 80) {
          health = "at-risk";
        }
      }

      return {
        projectId:      project.id,
        projectName:    project.name,
        status:         project.status,
        progress,
        totalTasks,
        completedTasks,
        remainingTasks: totalTasks - completedTasks,
        dueDate:        project.dueDate,
        health,
      };
    });

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_PROJECT_HEALTH);

    return result;
  },

  async getProjectStatusDistribution(workspaceId: string, userId: string) {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsProjectStatusDistribution(workspaceId);
    const cached = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const distribution = await prisma.project.groupBy({
      by:     ["status"],
      where:  { workspaceId },
      _count: { status: true },
    });

    const result = distribution.map((item) => ({
      status: item.status,
      count:  item._count.status,
    }));

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_DISTRIBUTION);

    return result;
  },

  async getMemberContribution(
    workspaceId: string,
    userId: string,
  ): Promise<MemberContribution[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsMemberContribution(workspaceId);
    const cached = await CacheClient.get<MemberContribution[]>(cacheKey);
    if (cached) return cached;

    const members = await prisma.workspaceMember.findMany({
      where:   { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    const memberIds = members.map((m) => m.userId);

    const [completedTaskRows, timeRows, commentRows, fileRows] = await Promise.all([
      prisma.taskAssignee.groupBy({
        by:     ["userId"],
        where:  { task: { workspaceId, status: "COMPLETED" }, userId: { in: memberIds } },
        _count: { taskId: true },
      }),
      prisma.timeEntry.groupBy({
        by:    ["userId"],
        where: { userId: { in: memberIds }, task: { workspaceId } },
        _sum:  { duration: true },
      }),
      prisma.comment.groupBy({
        by:     ["userId"],
        where:  { userId: { in: memberIds }, task: { workspaceId } },
        _count: { userId: true },
      }),
      prisma.file.groupBy({
        by:     ["uploadedById"],
        where:  { workspaceId, uploadedById: { in: memberIds } },
        _count: { uploadedById: true },
      }),
    ]);

    const completedTaskMap = new Map(completedTaskRows.map((r) => [r.userId, r._count.taskId]));
    const timeMap          = new Map(timeRows.map((r) => [r.userId, minutesToHours(r._sum.duration)]));
    const commentMap       = new Map(commentRows.map((r) => [r.userId, r._count.userId]));
    const fileMap          = new Map(fileRows.map((r) => [r.uploadedById, r._count.uploadedById]));

    const result = members
      .map((member) => {
        const completedTasks = completedTaskMap.get(member.userId) ?? 0;
        const totalHours     = timeMap.get(member.userId) ?? 0;
        const commentsCount  = commentMap.get(member.userId) ?? 0;
        const filesCount     = fileMap.get(member.userId) ?? 0;
        return {
          userId:            member.user.id,
          userName:          member.user.name,
          userEmail:         member.user.email,
          userImage:         member.user.image,
          role:              member.role,
          completedTasks,
          totalHours,
          commentsCount,
          filesCount,
          contributionScore: completedTasks * 2 + totalHours + commentsCount * 0.5,
        };
      })
      .sort((a, b) => b.contributionScore - a.contributionScore);

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_MEMBER_METRICS);

    return result;
  },

  async getTimeTrackingSummary(
    workspaceId: string,
    userId: string,
    days: number = 7,
  ): Promise<TimeTrackingSummary> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsTimeSummary(workspaceId, days);
    const cached = await CacheClient.get<TimeTrackingSummary>(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const timeWhere = { task: { workspaceId }, startedAt: { gte: startDate } };

    // ── Step 1: all time-entry aggregations in one round-trip ────────────────
    const [totalResult, memberGroups, taskGroups] = await Promise.all([
      prisma.timeEntry.aggregate({ where: timeWhere, _sum: { duration: true } }),
      prisma.timeEntry.groupBy({ by: ["userId"],  where: timeWhere, _sum: { duration: true } }),
      prisma.timeEntry.groupBy({
        by:      ["taskId"],
        where:   timeWhere,
        _sum:    { duration: true },
        orderBy: { _sum: { duration: "desc" } },
        take:    10,  // top-10 pushed into DB, not JS
      }),
    ]);

    const totalHours = minutesToHours(totalResult._sum.duration);

    const avgHoursPerMember = memberGroups.length > 0
      ? Math.round(
          (memberGroups.reduce((sum, g) => sum + (g._sum.duration ?? 0), 0) /
            memberGroups.length / 60) * 100,
        ) / 100
      : 0;

    // ── Step 2: resolve task→project for the top-10 groups only ─────────────
    // A single findMany for at most 10 tasks — not an async inside Promise.all
    const taskIds = taskGroups.map((g) => g.taskId).filter(Boolean) as string[];

    const tasks = taskIds.length > 0
      ? await prisma.task.findMany({
          where:  { id: { in: taskIds } },
          select: { id: true, project: { select: { id: true, name: true } } },
        })
      : [];

    // O(1) Map lookup — replaces the O(N×M) tasks.find() inside forEach
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Aggregate hours per project
    const projectHoursMap = new Map<string, { name: string; hours: number }>();
    for (const group of taskGroups) {
      const task = taskMap.get(group.taskId!);
      if (!task?.project) continue;
      const hours = minutesToHours(group._sum.duration);
      const existing = projectHoursMap.get(task.project.id);
      if (existing) {
        existing.hours += hours;
      } else {
        projectHoursMap.set(task.project.id, { name: task.project.name, hours });
      }
    }

    const projectBreakdown = Array.from(projectHoursMap.entries())
      .map(([projectId, { name, hours }]) => ({ projectId, projectName: name, hours }))
      .sort((a, b) => b.hours - a.hours);

    const result = { totalHours, avgHoursPerMember, projectBreakdown };

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_MEMBER_METRICS);

    return result;
  },

  async getActivityVolumeTrend(
    workspaceId: string,
    userId: string,
    days: number = 30,
  ): Promise<ActivityVolumePoint[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsActivityTrends(workspaceId, days);
    const cached = await CacheClient.get<ActivityVolumePoint[]>(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const activities = await prisma.activity.findMany({
      where:   { workspaceId, createdAt: { gte: startDate } },
      select:  { action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Pre-seed every day in the window so gaps appear as zeros
    const trendMap = new Map<string, Map<string, number>>();
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      trendMap.set(getDayKey(date), new Map());
    }

    for (const activity of activities) {
      const dateKey = getDayKey(activity.createdAt);
      const dayMap  = trendMap.get(dateKey) ?? new Map<string, number>();
      dayMap.set(activity.action, (dayMap.get(activity.action) ?? 0) + 1);
      trendMap.set(dateKey, dayMap);
    }

    const result = Array.from(trendMap.entries()).map(([date, actions]) => ({
      date:      new Date(date),
      created:   actions.get("CREATED")   ?? 0,
      updated:   actions.get("UPDATED")   ?? 0,
      completed: actions.get("COMPLETED") ?? 0,
      assigned:  actions.get("ASSIGNED")  ?? 0,
      total:     Array.from(actions.values()).reduce((sum, n) => sum + n, 0),
    }));

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_MEMBER_METRICS);

    return result;
  },

  async getMostActiveDay(
    workspaceId: string,
    userId: string,
  ): Promise<MostActiveDay> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsMostActiveDay(workspaceId);
    const cached = await CacheClient.get<MostActiveDay>(cacheKey);
    if (cached) return cached;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activities = await prisma.activity.findMany({
      where:  { workspaceId, createdAt: { gte: thirtyDaysAgo } },
      select: { action: true, createdAt: true },
    });

    const dayMap = new Map<string, { count: number; actions: Map<string, number> }>();

    for (const activity of activities) {
      const dayOfWeek = getWeekOfDay(activity.createdAt);
      const dayData   = dayMap.get(dayOfWeek) ?? { count: 0, actions: new Map() };
      dayData.count  += 1;
      dayData.actions.set(activity.action, (dayData.actions.get(activity.action) ?? 0) + 1);
      dayMap.set(dayOfWeek, dayData);
    }

    const sorted = Array.from(dayMap.entries())
      .map(([day, data]) => ({
        day,
        count:            data.count,
        mostCommonAction: Array.from(data.actions.entries())
          .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "NONE",
      }))
      .sort((a, b) => b.count - a.count);

    const result = sorted[0] ?? { day: "None", count: 0, mostCommonAction: "NONE" };

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_MEMBER_METRICS);

    return result;
  },

  async getTasksPerMember(
    workspaceId: string,
    userId: string,
  ): Promise<MemberWorkload[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsWorkload(workspaceId);
    const cached = await CacheClient.get<MemberWorkload[]>(cacheKey);
    if (cached) return cached;

    const members = await prisma.workspaceMember.findMany({
      where:   { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    const assignedTaskRows = await prisma.taskAssignee.groupBy({
      by:     ["userId"],
      where:  {
        userId: { in: members.map((m) => m.userId) },
        task:   { workspaceId, status: { in: ["TODO", "IN_PROGRESS"] } },
      },
      _count: { taskId: true },
    });

    const assignedTaskMap = new Map(
      assignedTaskRows.map((r) => [r.userId, r._count.taskId]),
    );

    const result = members
      .map((member) => {
        const assignedTasks = assignedTaskMap.get(member.userId) ?? 0;
        const status: MemberWorkload["status"] =
          assignedTasks >= 15 ? "overloaded"
          : assignedTasks >= 10 ? "high"
          : "normal";

        return {
          userId:       member.user.id,
          userName:     member.user.name,
          userEmail:    member.user.email,
          assignedTasks,
          status,
        };
      })
      .sort((a, b) => b.assignedTasks - a.assignedTasks);

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_MEMBER_METRICS);

    return result;
  },

  async getTasksByPriority(workspaceId: string, userId: string) {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsTaskPriorityDistribution(workspaceId);
    const cached = await CacheClient.get(cacheKey);
    if (cached) return cached;

    const distribution = await prisma.task.groupBy({
      by:     ["priority"],
      where:  { workspaceId, status: { in: ["TODO", "IN_PROGRESS"] } },
      _count: { priority: true },
    });

    const result = distribution.map((item) => ({
      priority: item.priority,
      count:    item._count.priority,
    }));

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_DISTRIBUTION);

    return result;
  },

  async getDeadlineRiskAnalysis(
    workspaceId: string,
    userId: string,
  ): Promise<DeadlineRiskAnalysis> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const cacheKey = CACHE_KEYS.analyticsDeadlineRisk(workspaceId);
    const cached = await CacheClient.get<DeadlineRiskAnalysis>(cacheKey);
    if (cached) return cached;

    const now            = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Plain mutable array — Prisma's `in` filter requires TaskStatus[], not readonly tuple
    const activeStatuses: TaskStatus[] = ["TODO", "IN_PROGRESS"];

    const [dueIn3Days, dueIn7DaysCount, highPriorityNearDeadline] = await Promise.all([
      prisma.task.findMany({
        where: {
          workspaceId,
          status:  { in: activeStatuses },
          dueDate: { gte: now, lte: threeDaysLater },
        },
        // `select` and `include` cannot be mixed at the same level in Prisma.
        // Nested relations are expressed as `select` → relation → `select`.
        select: {
          id:       true,
          title:    true,
          dueDate:  true,
          priority: true,
          assignees: {
            select: { user: { select: { name: true } } },
          },
        },
      }),
      prisma.task.count({
        where: {
          workspaceId,
          status:  { in: activeStatuses },
          dueDate: { gte: now, lte: sevenDaysLater },
        },
      }),
      prisma.task.findMany({
        where: {
          workspaceId,
          status:   { in: activeStatuses },
          priority: { in: ["URGENT", "HIGH"] },
          dueDate:  { gte: now, lte: sevenDaysLater },
        },
        select: { id: true, title: true, dueDate: true, priority: true },
      }),
    ]);

    const riskLevel = (highPriorityNearDeadline.length >= 3 ? "high"
      : highPriorityNearDeadline.length >= 2 ? "medium"
      : "low") as DeadlineRiskAnalysis['riskLevel'];

    const result = {
      dueIn3Days: dueIn3Days.map(({ assignees, ...task }) => ({
        ...task,
        assignedTo: assignees.map((a) => a.user.name).join(", "),
      })),
      dueIn7DaysCount,
      highPriorityNearDeadline,
      riskLevel,
    };

    await CacheClient.set(cacheKey, result, CACHE_TTL.ANALYTICS_RISK_ANALYSIS);

    return result;
  },
};