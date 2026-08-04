import type {
  GrowthInsight,
  ResourceUsageMetrics,
  WorkspaceGrowthMetrics,
} from "./workspaceUsage.types.js";

export function bytesToMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export function daysBetween(date1: Date, date2: Date): number {
  return Math.floor(
    (date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function getDateRange(days: number): Date[] {
  const now = new Date();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    return d;
  });
}

export function getDayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function getMonthRange(
  months: number,
): Array<{ start: Date; end: Date; label: string }> {
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth() - (months - 1 - i),
      1,
    );
    const monthEnd = new Date(
      now.getFullYear(),
      now.getMonth() - (months - 1 - i) + 1,
      0,
      23,
      59,
      59,
    );
    return {
      start: monthStart,
      end: monthEnd,
      label: monthStart.toLocaleString("default", {
        month: "short",
        year: "numeric",
      }),
    };
  });
}

/**
 * Percentage change from `previous` to `current`, rounded to the nearest whole
 * number. Returns `null` when there is no meaningful baseline (previous is
 * zero/negative) so callers can hide change badges instead of showing `Infinity`.
 */
export function pctChange(
  previous: number,
  current: number,
): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Builds data-driven insights from the real growth + storage metrics. Each
 * insight is generated from live numbers so the UI never shows fabricated copy.
 */
export function buildGrowthInsights(
  workspaceGrowth: WorkspaceGrowthMetrics,
  resourceUsage: ResourceUsageMetrics,
): GrowthInsight[] {
  const { thisMonth, trend, projectLifecycle } = workspaceGrowth;
  const storagePct = resourceUsage.totalStorage.percentage;

  const prevMonth = trend[trend.length - 2];
  const taskChange = pctChange(prevMonth?.tasks ?? 0, thisMonth.newTasks);

  const insights: GrowthInsight[] = [];

  if (taskChange === null) {
    insights.push({
      id: 1,
      text: `Task creation held steady this month — ${thisMonth.newTasks} new tasks created.`,
      type: "neutral",
    });
  } else if (taskChange > 0) {
    insights.push({
      id: 1,
      text: `Task creation increased ${taskChange}% this month — strong team engagement.`,
      type: "positive",
    });
  } else {
    insights.push({
      id: 1,
      text: `Task creation dropped ${Math.abs(taskChange)}% this month — consider re-engaging the team.`,
      type: "warning",
    });
  }

  insights.push({
    id: 2,
    text:
      storagePct >= 75
        ? `Storage is ${storagePct}% used. Consider upgrading your plan soon.`
        : `Storage usage is healthy at ${storagePct}% of your plan limit.`,
    type: storagePct >= 75 ? "warning" : "positive",
  });

  insights.push({
    id: 3,
    text: `${projectLifecycle.active} active projects progressing with ${thisMonth.newTasks} new tasks added this month.`,
    type: "neutral",
  });

  return insights;
}
