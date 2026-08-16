import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { AnalyticsQuery } from "./analytics.query.js";
import { AnalyticsAccess } from "./analytics.access.js";
import { ProjectAccess } from "../project/project.access.js";
import { asyncHandler } from "../../errors/index.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

const parseDays = (value: unknown, fallback: number): number => {
  const n = parseInt(value as string, 10);
  return isNaN(n) ? fallback : n;
};

// ─── controller ───────────────────────────────────────────────────────────────

export class AnalyticsController {
  /**
   * GET /analytics/:workspaceId/overview
   *
   * Note: uses Promise.allSettled so a single query failure doesn't black out
   * the entire dashboard. Individual null values are returned with a flag so
   * the client can show partial data + a targeted error message.
   */
  static getOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.params;

    // Single access check — assertAnalyticsAccess covers plan + role
    await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

    const [
      kpisResult,
      taskStatusResult,
      projectStatusResult,
      priorityResult,
      deadlineResult,
    ] = await Promise.allSettled([
      AnalyticsQuery.getExecutiveKPIs(workspaceId, req.user!.id),
      AnalyticsQuery.getTaskStatusDistribution(workspaceId, req.user!.id),
      AnalyticsQuery.getProjectStatusDistribution(workspaceId, req.user!.id),
      AnalyticsQuery.getTasksByPriority(workspaceId, req.user!.id),
      AnalyticsQuery.getDeadlineRiskAnalysis(workspaceId, req.user!.id),
    ]);

    // Log individual failures without crashing the whole response
    [
      kpisResult,
      taskStatusResult,
      projectStatusResult,
      priorityResult,
      deadlineResult,
    ].forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`Analytics overview query [${i}] failed:`, r.reason);
      }
    });

    res.json({
      success: true,
      data: {
        kpis: kpisResult.status === "fulfilled" ? kpisResult.value : null,
        taskStatus:
          taskStatusResult.status === "fulfilled"
            ? taskStatusResult.value
            : null,
        projectStatus:
          projectStatusResult.status === "fulfilled"
            ? projectStatusResult.value
            : null,
        tasksByPriority:
          priorityResult.status === "fulfilled" ? priorityResult.value : null,
        deadlineRisk:
          deadlineResult.status === "fulfilled" ? deadlineResult.value : null,
      },
      // Tell the client if something partially failed
      partial: [
        kpisResult,
        taskStatusResult,
        projectStatusResult,
        priorityResult,
        deadlineResult,
      ].some((r) => r.status === "rejected"),
    });
  });

  static getTaskTrends = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

      const days = parseDays(req.query.days, 30);

      const [completionTrend, overdueTrend] = await Promise.all([
        AnalyticsQuery.getTaskCompletionTrend(workspaceId, req.user!.id, days),
        AnalyticsQuery.getOverdueTrend(workspaceId, req.user!.id, days),
      ]);

      res.json({ success: true, data: { completionTrend, overdueTrend } });
    },
  );

  static getProjectHealth = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

      const metrics = await AnalyticsQuery.getProjectHealthMetrics(
        workspaceId,
        req.user!.id,
      );
      res.json({ success: true, data: metrics });
    },
  );

  static getMemberContribution = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

      const hasBusinessAccess = await AnalyticsAccess.assertBusinessOnlyAccess(
        req.user!.id, workspaceId,
      );
      if (!hasBusinessAccess) {
        res.json({ success: true, data: null });
        return;
      }

      const contributions = await AnalyticsQuery.getMemberContribution(
        workspaceId,
        req.user!.id,
      );
      res.json({ success: true, data: contributions });
    },
  );

  static getTimeSummary = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

      const days = parseDays(req.query.days, 7);
      const summary = await AnalyticsQuery.getTimeTrackingSummary(
        workspaceId,
        req.user!.id,
        days,
      );
      res.json({ success: true, data: summary });
    },
  );

  static getTimeReport = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

      const days = parseDays(req.query.days, 7);
      const report = await AnalyticsQuery.getTimeTrackingReport(
        workspaceId,
        req.user!.id,
        days,
      );
      res.json({ success: true, data: report });
    },
  );

  static getActivityTrends = asyncHandler(
    async (req: AuthRequest, res: Response) => {
      const { workspaceId } = req.params;
      await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

      const hasBusinessAccess = await AnalyticsAccess.assertBusinessOnlyAccess(
        req.user!.id, workspaceId,
      );
      if (!hasBusinessAccess) {
        res.json({ success: true, data: null });
        return;
      }

      const days = parseDays(req.query.days, 30);

      const [volumeTrend, mostActiveDay] = await Promise.all([
        AnalyticsQuery.getActivityVolumeTrend(workspaceId, req.user!.id, days),
        AnalyticsQuery.getMostActiveDay(workspaceId, req.user!.id),
      ]);

      res.json({ success: true, data: { volumeTrend, mostActiveDay } });
    },
  );

  static getWorkload = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId } = req.params;
    await AnalyticsAccess.assertAnalyticsAccess(req.user!.id, workspaceId);

    const hasBusinessAccess = await AnalyticsAccess.assertBusinessOnlyAccess(
      req.user!.id, workspaceId,
    );
    if (!hasBusinessAccess) {
      res.json({ success: true, data: null });
      return;
    }

    const tasksPerMember = await AnalyticsQuery.getTasksPerMember(
      workspaceId,
      req.user!.id,
    );
    res.json({ success: true, data: tasksPerMember });
  });

  // ─── Project Analytics ───────────────────────────────────────────────────────

  static getProjectOverview = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, projectId } = req.params;
    const days = parseDays(req.query.days, 30);

    // Access gate — a user without project access gets 403 FORBIDDEN so the
    // client renders the "access restricted" screen instead of partial data
    // with an error toast. Mirrors the project sub-page gates.
    await ProjectAccess.assertProjectAccess(req.user!.id, projectId);

    const [kpis, taskStatus, priority, trend, deadlineRisk] = await Promise.allSettled([
      AnalyticsQuery.getProjectAnalyticsKPIs(workspaceId, projectId, req.user!.id),
      AnalyticsQuery.getProjectTaskStatusDistribution(workspaceId, projectId, req.user!.id),
      AnalyticsQuery.getProjectTaskPriorityDistribution(workspaceId, projectId, req.user!.id),
      AnalyticsQuery.getProjectCompletionTrend(workspaceId, projectId, req.user!.id, days),
      AnalyticsQuery.getProjectDeadlineRisk(workspaceId, projectId, req.user!.id),
    ]);

    res.json({
      success: true,
      data: {
        kpis: kpis.status === "fulfilled" ? kpis.value : null,
        taskStatus: taskStatus.status === "fulfilled" ? taskStatus.value : null,
        priority: priority.status === "fulfilled" ? priority.value : null,
        completionTrend: trend.status === "fulfilled" ? trend.value : null,
        deadlineRisk: deadlineRisk.status === "fulfilled" ? deadlineRisk.value : null,
      },
      partial: [kpis, taskStatus, priority, trend, deadlineRisk].some((r) => r.status === "rejected"),
    });
  });

  static getProjectCompletionTrend = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, projectId } = req.params;
    await AnalyticsAccess.assertProjectAnalyticsAccess(req.user!.id, workspaceId, projectId);

    const days = parseDays(req.query.days, 30);
    const trend = await AnalyticsQuery.getProjectCompletionTrend(
      workspaceId,
      projectId,
      req.user!.id,
      days,
    );
    res.json({ success: true, data: trend });
  });

  static getProjectMemberContribution = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, projectId } = req.params;
    await AnalyticsAccess.assertProjectAnalyticsAccess(req.user!.id, workspaceId, projectId);

    const contributions = await AnalyticsQuery.getProjectMemberContribution(
      workspaceId,
      projectId,
      req.user!.id,
    );
    res.json({ success: true, data: contributions });
  });

  static getProjectTimeSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, projectId } = req.params;
    await AnalyticsAccess.assertProjectAnalyticsAccess(req.user!.id, workspaceId, projectId);

    const days = parseDays(req.query.days, 7);
    const summary = await AnalyticsQuery.getProjectTimeTrackingSummary(
      workspaceId,
      projectId,
      req.user!.id,
      days,
    );
    res.json({ success: true, data: summary });
  });

  static getProjectTimeReport = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, projectId } = req.params;
    await AnalyticsAccess.assertProjectAnalyticsAccess(req.user!.id, workspaceId, projectId);

    const days = parseDays(req.query.days, 7);
    const report = await AnalyticsQuery.getProjectTimeReport(
      workspaceId,
      projectId,
      req.user!.id,
      days,
    );
    res.json({ success: true, data: report });
  });

  static getProjectDeadlineRisk = asyncHandler(async (req: AuthRequest, res: Response) => {
    const { workspaceId, projectId } = req.params;
    await AnalyticsAccess.assertProjectAnalyticsAccess(req.user!.id, workspaceId, projectId);

    const risk = await AnalyticsQuery.getProjectDeadlineRisk(
      workspaceId,
      projectId,
      req.user!.id,
    );
    res.json({ success: true, data: risk });
  });
}
