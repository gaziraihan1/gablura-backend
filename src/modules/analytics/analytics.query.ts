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
import { CacheClient, CACHE_KEYS, CACHE_TTL } from "../../lib/redis/cache.client.js";

export const AnalyticsQuery = {

  async getExecutiveKPIs(
    workspaceId: string,
    userId: string,
  ): Promise<ExecutiveKPIs> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    // Try cache first
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
          status: { in: ["TODO", "IN_PROGRESS"] },
          dueDate: { lt: new Date() },
        },
      }),
      prisma.workspaceMember.count({ where: { workspaceId } }),
      prisma.activity
        .groupBy({
          by: ["userId"],
          where: {
            workspaceId,
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          },
        })
        .then((groups) => groups.length),
      prisma.timeEntry
        .aggregate({
          where: { task: { workspaceId } },
          _sum: { duration: true },
        })
        .then((result) => minutesToHours(result._sum.duration)),
      prisma.file
        .aggregate({
          where: { workspaceId },
          _sum: { size: true },
        })
        .then((result) => bytesToMB(result._sum.size)),
    ]);

    const completionRate =
      totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const kpis = {
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

    // Cache the result
    await CacheClient.set(cacheKey, kpis, CACHE_TTL.ANALYTICS_DASHBOARD);

    return kpis;
  },

  async getTaskStatusDistribution(
    workspaceId: string,
    userId: string,
  ): Promise<TaskStatusDistribution[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const distribution = await prisma.task.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { status: true },
    });

    const total = distribution.reduce(
      (sum, item) => sum + item._count.status,
      0,
    );

    return distribution.map((item) => ({
      status: item.status,
      count: item._count.status,
      percentage:
        total > 0 ? Math.round((item._count.status / total) * 100) : 0,
    }));
  },

  async getTaskCompletionTrend(
  workspaceId: string,
  userId: string,
  days: number = 30,
): Promise<TrendDataPoint[]> {
  await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  // ── Single GROUP BY query — zero rows in Node memory ─────────────────────
  // Replaces findMany (potentially 100K rows) + JS forEach grouping.
  // DATE_TRUNC truncates each completedAt to midnight so the GROUP BY key
  // matches exactly what getDayKey() was producing.
  const rows = await prisma.$queryRaw<{ day: Date; count: bigint }[]>`
    SELECT
      DATE_TRUNC('day', "completedAt") AS day,
      COUNT(*)                         AS count
    FROM   tasks
    WHERE  "workspaceId" = ${workspaceId}
      AND  status        = 'COMPLETED'
      AND  "completedAt" >= ${startDate}
    GROUP  BY DATE_TRUNC('day', "completedAt")
    ORDER  BY day ASC
  `;

  // Index the DB results by ISO date string for O(1) lookup
  const dbMap = new Map<string, number>(
    rows.map((r) => [getDayKey(r.day), Number(r.count)]),
  );

  // Fill every day in the window — days with no completions default to 0.
  // This keeps the same dense-array contract the old code guaranteed.
  const trend: TrendDataPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const key = getDayKey(date);
    trend.push({ date: new Date(date), count: dbMap.get(key) ?? 0 });
  }

  return trend;
},

  async getOverdueTrend(
    workspaceId: string,
    userId: string,
    days: number = 30,
  ): Promise<OverdueTrendPoint[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const overdueTasks = await prisma.task.findMany({
      where: {
        workspaceId,
        dueDate: { gte: startDate, lt: new Date() },
        status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      },
      select: { dueDate: true },
      orderBy: { dueDate: "asc" },
    });

    const weekMap = new Map<string, number>();
    for (let i = 0; i < Math.ceil(days / 7); i++) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + i * 7);
      weekMap.set(getDayKey(weekStart), 0);
    }

    overdueTasks.forEach((task) => {
      if (task.dueDate) {
        const daysSinceStart = Math.floor(
          (task.dueDate.getTime() - startDate.getTime()) /
            (24 * 60 * 60 * 1000),
        );
        const weekIndex = Math.floor(daysSinceStart / 7);
        const weekStart = new Date(startDate);
        weekStart.setDate(weekStart.getDate() + weekIndex * 7);
        const weekKey = getDayKey(weekStart);
        weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + 1);
      }
    });

    return Array.from(weekMap.entries()).map(([date, count]) => ({
      weekStart: new Date(date),
      count,
    }));
  },

  async getProjectHealthMetrics(
    workspaceId: string,
    userId: string,
  ): Promise<ProjectHealth[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const projects = await prisma.project.findMany({
      where: { workspaceId },
      include: {
        _count: { select: { tasks: true } },
        tasks: {
          where: { status: "COMPLETED" },
          select: { id: true },
        },
      },
    });

    return projects.map((project) => {
      const totalTasks = project._count.tasks;
      const completedTasks = project.tasks.length;
      const progress =
        totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

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
        projectId: project.id,
        projectName: project.name,
        status: project.status,
        progress,
        totalTasks,
        completedTasks,
        remainingTasks: totalTasks - completedTasks,
        dueDate: project.dueDate,
        health,
      };
    });
  },

  async getProjectStatusDistribution(workspaceId: string, userId: string) {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const distribution = await prisma.project.groupBy({
      by: ["status"],
      where: { workspaceId },
      _count: { status: true },
    });

    return distribution.map((item) => ({
      status: item.status,
      count: item._count.status,
    }));
  },

  async getMemberContribution(
    workspaceId: string,
    userId: string,
  ): Promise<MemberContribution[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    const [completedTaskRows, timeRows, commentRows, fileRows] =
      await Promise.all([
        prisma.taskAssignee.groupBy({
          by: ["userId"],
          where: {
            task: { workspaceId, status: "COMPLETED" },
            userId: { in: members.map((m) => m.userId) },
          },
          _count: { taskId: true },
        }),
        prisma.timeEntry.groupBy({
          by: ["userId"],
          where: {
            userId: { in: members.map((m) => m.userId) },
            task: { workspaceId },
          },
          _sum: { duration: true },
        }),
        prisma.comment.groupBy({
          by: ["userId"],
          where: {
            userId: { in: members.map((m) => m.userId) },
            task: { workspaceId },
          },
          _count: { userId: true },
        }),
        prisma.file.groupBy({
          by: ["uploadedById"],
          where: {
            workspaceId,
            uploadedById: { in: members.map((m) => m.userId) },
          },
          _count: { uploadedById: true },
        }),
      ]);

    const completedTaskMap = new Map(
      completedTaskRows.map((r) => [r.userId, r._count.taskId]),
    );
    const timeMap = new Map(
      timeRows.map((r) => [r.userId, minutesToHours(r._sum.duration)]),
    );
    const commentMap = new Map(
      commentRows.map((r) => [r.userId, r._count.userId]),
    );
    const fileMap = new Map(
      fileRows.map((r) => [r.uploadedById, r._count.uploadedById]),
    );

    const contributions = members.map((member) => {
      const completedTasks = completedTaskMap.get(member.userId) ?? 0;
      const totalHours = timeMap.get(member.userId) ?? 0;
      const commentsCount = commentMap.get(member.userId) ?? 0;
      const filesCount = fileMap.get(member.userId) ?? 0;
      return {
        userId: member.user.id,
        userName: member.user.name,
        userEmail: member.user.email,
        userImage: member.user.image,
        role: member.role,
        completedTasks,
        totalHours,
        commentsCount,
        filesCount,
        contributionScore: completedTasks * 2 + totalHours + commentsCount * 0.5,
      };
    });

    return contributions.sort(
      (a, b) => b.contributionScore - a.contributionScore,
    );
  },

  async getTimeTrackingSummary(
    workspaceId: string,
    userId: string,
    days: number = 7,
  ): Promise<TimeTrackingSummary> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [totalHours, memberHours, projectHours] = await Promise.all([
      prisma.timeEntry
        .aggregate({
          where: { task: { workspaceId }, startedAt: { gte: startDate } },
          _sum: { duration: true },
        })
        .then((result) => minutesToHours(result._sum.duration)),

      prisma.timeEntry
        .groupBy({
          by: ["userId"],
          where: { task: { workspaceId }, startedAt: { gte: startDate } },
          _sum: { duration: true },
        })
        .then((groups) => {
          const memberCount = groups.length;
          const totalMinutes = groups.reduce(
            (sum, g) => sum + (g._sum.duration || 0),
            0,
          );
          return memberCount > 0
            ? Math.round((totalMinutes / memberCount / 60) * 100) / 100
            : 0;
        }),

      prisma.timeEntry
        .groupBy({
          by: ["taskId"],
          where: { task: { workspaceId }, startedAt: { gte: startDate } },
          _sum: { duration: true },
        })
        .then(async (groups) => {
          const sortedGroups = groups
            .sort((a, b) => (b._sum.duration || 0) - (a._sum.duration || 0))
            .slice(0, 10);

          const tasks = await prisma.task.findMany({
            where: { id: { in: sortedGroups.map((g) => g.taskId) } },
            select: {
              id: true,
              title: true,
              project: { select: { id: true, name: true } },
            },
          });

          const projectMap = new Map<string, number>();

          sortedGroups.forEach((group) => {
            const task = tasks.find((t) => t.id === group.taskId);
            if (task?.project) {
              const hours = minutesToHours(group._sum.duration);
              projectMap.set(
                task.project.id,
                (projectMap.get(task.project.id) || 0) + hours,
              );
            }
          });

          return Array.from(projectMap.entries())
            .map(([projectId, hours]) => {
              const task = tasks.find((t) => t.project?.id === projectId);
              return {
                projectId,
                projectName: task?.project?.name || "Unknown",
                hours,
              };
            })
            .sort((a, b) => b.hours - a.hours);
        }),
    ]);

    return {
      totalHours,
      avgHoursPerMember: memberHours,
      projectBreakdown: projectHours,
    };
  },

  async getActivityVolumeTrend(
    workspaceId: string,
    userId: string,
    days: number = 30,
  ): Promise<ActivityVolumePoint[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const activities = await prisma.activity.findMany({
      where: { workspaceId, createdAt: { gte: startDate } },
      select: { action: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const trendMap = new Map<string, Map<string, number>>();
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      trendMap.set(getDayKey(date), new Map());
    }

    activities.forEach((activity) => {
      const dateKey = getDayKey(activity.createdAt);
      const dayMap = trendMap.get(dateKey) || new Map();
      dayMap.set(activity.action, (dayMap.get(activity.action) || 0) + 1);
      trendMap.set(dateKey, dayMap);
    });

    return Array.from(trendMap.entries()).map(([date, actions]) => ({
      date: new Date(date),
      created: actions.get("CREATED") || 0,
      updated: actions.get("UPDATED") || 0,
      completed: actions.get("COMPLETED") || 0,
      assigned: actions.get("ASSIGNED") || 0,
      total: Array.from(actions.values()).reduce(
        (sum, count) => sum + count,
        0,
      ),
    }));
  },

  async getMostActiveDay(
    workspaceId: string,
    userId: string,
  ): Promise<MostActiveDay> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const activities = await prisma.activity.findMany({
      where: { workspaceId, createdAt: { gte: thirtyDaysAgo } },
      select: { action: true, createdAt: true },
    });

    const dayMap = new Map<
      string,
      { count: number; actions: Map<string, number> }
    >();

    activities.forEach((activity) => {
      const dayOfWeek = getWeekOfDay(activity.createdAt);
      const dayData = dayMap.get(dayOfWeek) || { count: 0, actions: new Map() };
      dayData.count += 1;
      dayData.actions.set(
        activity.action,
        (dayData.actions.get(activity.action) || 0) + 1,
      );
      dayMap.set(dayOfWeek, dayData);
    });

    const sorted = Array.from(dayMap.entries())
      .map(([day, data]) => ({
        day,
        count: data.count,
        mostCommonAction:
          Array.from(data.actions.entries()).sort(
            (a, b) => b[1] - a[1],
          )[0]?.[0] || "NONE",
      }))
      .sort((a, b) => b.count - a.count);

    return sorted[0] || { day: "None", count: 0, mostCommonAction: "NONE" };
  },

  async getTasksPerMember(
    workspaceId: string,
    userId: string,
  ): Promise<MemberWorkload[]> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const members = await prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const assignedTaskRows = await prisma.taskAssignee.groupBy({
      by: ["userId"],
      where: {
        userId: { in: members.map((m) => m.userId) },
        task: {
          workspaceId,
          status: { in: ["TODO", "IN_PROGRESS"] },
        },
      },
      _count: { taskId: true },
    });
    const assignedTaskMap = new Map(
      assignedTaskRows.map((r) => [r.userId, r._count.taskId]),
    );

    const workload = members.map((member) => {
      const assignedTasks = assignedTaskMap.get(member.userId) ?? 0;
      let status: "normal" | "high" | "overloaded" = "normal";
      if (assignedTasks >= 15) status = "overloaded";
      else if (assignedTasks >= 10) status = "high";

      return {
        userId: member.user.id,
        userName: member.user.name,
        userEmail: member.user.email,
        assignedTasks,
        status,
      };
    });

    return workload.sort((a, b) => b.assignedTasks - a.assignedTasks);
  },

  async getTasksByPriority(workspaceId: string, userId: string) {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const distribution = await prisma.task.groupBy({
      by: ["priority"],
      where: { workspaceId, status: { in: ["TODO", "IN_PROGRESS"] } },
      _count: { priority: true },
    });

    return distribution.map((item) => ({
      priority: item.priority,
      count: item._count.priority,
    }));
  },

  async getDeadlineRiskAnalysis(
    workspaceId: string,
    userId: string,
  ): Promise<DeadlineRiskAnalysis> {
    await AnalyticsAccess.assertWorkspaceAdminOrOwner(userId, workspaceId);

    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [dueIn3Days, dueIn7Days, highPriorityNearDeadline] =
      await Promise.all([
        prisma.task.findMany({
          where: {
            workspaceId,
            status: { in: ["TODO", "IN_PROGRESS"] },
            dueDate: { gte: now, lte: threeDaysLater },
          },
          select: {
            id: true,
            title: true,
            dueDate: true,
            priority: true,
            assignees: {
              include: { user: { select: { name: true } } },
            },
          },
        }),

        prisma.task.count({
          where: {
            workspaceId,
            status: { in: ["TODO", "IN_PROGRESS"] },
            dueDate: { gte: now, lte: sevenDaysLater },
          },
        }),

        prisma.task.findMany({
          where: {
            workspaceId,
            status: { in: ["TODO", "IN_PROGRESS"] },
            priority: { in: ["URGENT", "HIGH"] },
            dueDate: { gte: now, lte: sevenDaysLater },
          },
          select: { id: true, title: true, dueDate: true, priority: true },
        }),
      ]);

    return {
      dueIn3Days: dueIn3Days.map((task) => ({
        ...task,
        assignedTo: task.assignees.map((a) => a.user.name).join(", "),
      })),
      dueIn7DaysCount: dueIn7Days,
      highPriorityNearDeadline,
      riskLevel:
        highPriorityNearDeadline.length >= 5
          ? "high"
          : highPriorityNearDeadline.length >= 2
            ? "medium"
            : "low",
    };
  },
};