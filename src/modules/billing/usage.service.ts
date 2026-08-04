import { prisma } from "../../lib/prisma.js";
import { PlanLimitError } from "../../errors/AppError.js";
import { PLAN_LIMITS } from "../billing/plans.config.js";

type UsageMetricType = "MEMBERS" | "STORAGE_MB" | "MEETINGS_PER_MONTH" | "PROJECTS" | "FILE_UPLOADS" | "API_CALLS";

/**
 * Track and enforce monthly usage limits for workspace operations.
 *
 * Each call to `increment` atomically upserts the UsageRecord for the
 * current calendar month and returns the updated count. If the increment
 * would exceed the plan's limit, a PlanLimitError is thrown.
 *
 * TODO: Mount these in the relevant route handlers (task creation, file
 * upload, meeting creation, API call, etc.) alongside the existing
 * planGuard middleware.
 */
export const UsageService = {
  /**
   * Upsert a UsageRecord for the given workspaceId + metric, incrementing
   * the value by `by` (default 1). Throws PlanLimitError if the new value
   * exceeds the plan's monthly limit.
   *
   * @param workspaceId  - The workspace to track usage for.
   * @param metric       - The UsageMetric enum value.
   * @param by           - How much to increment (default 1).
   */
  async increment(
    workspaceId: string,
    metric: UsageMetricType,
    by: number = 1,
  ): Promise<number> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Get the workspace's plan limits for this metric
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true },
    });

    const limits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.FREE;
    const limit = getLimitForMetric(limits, metric);

    // -1 means unlimited
    if (limit === -1) {
      // Still upsert for tracking, but don't enforce
      await prisma.usageRecord.upsert({
        where: { workspaceId_metric_periodStart: { workspaceId, metric, periodStart } },
        create: { workspaceId, metric, value: by, limit, periodStart, periodEnd },
        update: { value: { increment: by }, periodEnd },
      });
      return 0;
    }

    // Atomic upsert + increment in a transaction
    const record = await prisma.$transaction(async (tx) => {
      const existing = await tx.usageRecord.findUnique({
        where: { workspaceId_metric_periodStart: { workspaceId, metric, periodStart } },
      });

      if (existing) {
        const newValue = existing.value + by;
        if (newValue > limit) {
          throw new PlanLimitError(
            `Monthly ${metric.toLowerCase().replace(/_/g, " ")} limit reached (${limit}). ` +
            `Upgrade your workspace plan to increase the limit.`,
          );
        }
        return tx.usageRecord.update({
          where: { id: existing.id },
          data: { value: { increment: by }, periodEnd },
        });
      }

      // First time this month — create the record
      if (by > limit) {
        throw new PlanLimitError(
          `Monthly ${metric.toLowerCase().replace(/_/g, " ")} limit reached (${limit}). ` +
          `Upgrade your workspace plan to increase the limit.`,
        );
      }

      return tx.usageRecord.create({
        data: { workspaceId, metric, value: by, limit, periodStart, periodEnd },
      });
    });

    return record.value;
  },

  /**
   * Check the current usage for a metric without incrementing.
   * Returns { current: number, limit: number, remaining: number }.
   * Returns all zeros when the metric is unlimited (-1).
   */
  async check(
    workspaceId: string,
    metric: UsageMetricType,
  ): Promise<{ current: number; limit: number; remaining: number }> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { plan: true },
    });

    const limits = PLAN_LIMITS[workspace.plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.FREE;
    const limit = getLimitForMetric(limits, metric);

    if (limit === -1) {
      return { current: 0, limit: -1, remaining: -1 };
    }

    const record = await prisma.usageRecord.findUnique({
      where: { workspaceId_metric_periodStart: { workspaceId, metric, periodStart } },
    });

    const current = record?.value ?? 0;
    return { current, limit, remaining: Math.max(0, limit - current) };
  },
};

function getLimitForMetric(limits: typeof PLAN_LIMITS[keyof typeof PLAN_LIMITS], metric: UsageMetricType): number {
  switch (metric) {
    case "MEMBERS":          return limits.maxMembersPerWs;
    case "MEETINGS_PER_MONTH": return limits.maxMeetingsPerMo;
    case "PROJECTS":         return limits.maxProjects;
    case "FILE_UPLOADS":     return -1; // file uploads have no monthly limit (storage-based)
    case "API_CALLS":        return -1; // API calls have no monthly limit for now
    case "STORAGE_MB":       return -1; // storage is tracked via maxStorageMb
    default:                 return -1;
  }
}