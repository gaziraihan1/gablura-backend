import { prisma } from "../../lib/prisma.js";
import type { BurnoutSignal, CalendarInsights } from "./calendar.types.js";
import type { RiskLevel } from "./calendar.types.js";
import { CalendarAggregation } from "./calendar.aggregation.js";
import {
  countWorkDays,
  getWorkDayNumbers,
  countConsecutiveDays,
  getWeekStart,
} from "./calendar.utils.js";
import { CacheClient, CACHE_KEYS, CACHE_TTL } from "../../lib/redis/cache.client.js";

export const CalendarInsightsService = {
  async getInsights(
    userId: string,
    workspaceId: string | undefined,
    startDate: Date,
    endDate: Date,
  ): Promise<CalendarInsights> {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const cacheKey = CACHE_KEYS.calendarInsights(userId, workspaceId, startDateStr, endDateStr);
    
    const cached = await CacheClient.get<CalendarInsights>(cacheKey);
    if (cached) return cached;

    const [aggregates, capacity, schedule, timeEntries] = await Promise.all([
      CalendarAggregation.getOrComputeAggregates({
        userId,
        workspaceId,
        startDate,
        endDate,
      }),
      prisma.userCapacity.findUnique({ where: { userId } }),
      prisma.userWorkSchedule.findUnique({ where: { userId } }),
      prisma.timeEntry.findMany({
        where: {
          userId,
          startedAt: { gte: startDate, lte: endDate },
        },
        select: { category: true, duration: true },
      }),
    ]);

    const workDays = (schedule?.workDays as string[]) ?? [
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ];
    const dailyCapacity = capacity?.dailyCapacityHours ?? 8;
    const workDaysCount = countWorkDays(startDate, endDate, workDays);

    const totalPlannedHours = aggregates.reduce(
      (sum, agg) => sum + agg.plannedHours,
      0,
    );
    const totalCapacityHours = workDaysCount * dailyCapacity;
    const commitmentGap = totalPlannedHours - totalCapacityHours;
    const overloadedDays = aggregates.filter((agg) => agg.overCapacity).length;
    const focusDays = aggregates.filter((agg) => agg.hasPrimaryFocus).length;

    const burnoutSignal = await this.calculateBurnoutRisk(userId, startDate);

    // Compute time allocation from time entries
    const categoryTotals: Record<string, number> = { DEEP_WORK: 0, MEETINGS: 0, ADMIN: 0, LEARNING: 0, OTHER: 0 };
    let totalTrackedMinutes = 0;
    for (const entry of timeEntries) {
      const cat = entry.category as string;
      if (categoryTotals[cat] !== undefined) {
        categoryTotals[cat] += entry.duration;
      } else {
        categoryTotals.OTHER += entry.duration;
      }
      totalTrackedMinutes += entry.duration;
    }

    const timeAllocation = totalTrackedMinutes > 0 ? {
      deepWork: Math.round((categoryTotals.DEEP_WORK / totalTrackedMinutes) * 100),
      meetings: Math.round((categoryTotals.MEETINGS / totalTrackedMinutes) * 100),
      admin:    Math.round((categoryTotals.ADMIN / totalTrackedMinutes) * 100),
      learning: Math.round((categoryTotals.LEARNING / totalTrackedMinutes) * 100),
      other:    Math.round((categoryTotals.OTHER / totalTrackedMinutes) * 100),
    } : null;

    const result = {
      totalPlannedHours,
      totalCapacityHours,
      commitmentGap,
      overloadedDays,
      focusDays,
      burnoutRisk: burnoutSignal.riskLevel,
      timeAllocation,
    };

    await CacheClient.set(cacheKey, result, CACHE_TTL.CALENDAR_INSIGHTS);
    return result;
  },

  async calculateBurnoutRisk(
    userId: string,
    weekStart: Date,
  ): Promise<BurnoutSignal> {
    const normalizedWeekStart = getWeekStart(weekStart);

    const weekEnd = new Date(normalizedWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const [aggregates, schedule, energyLevels, focusSessions] = await Promise.all([
      CalendarAggregation.getOrComputeAggregates({
        userId,
        startDate: normalizedWeekStart,
        endDate: weekEnd,
      }),
      prisma.userWorkSchedule.findUnique({ where: { userId } }),
      prisma.energyLevel.findMany({
        where: { userId, date: { gte: normalizedWeekStart, lte: weekEnd } },
        select: { date: true, energyLevel: true },
      }),
      prisma.focusSession.findMany({
        where: {
          userId,
          startedAt: { gte: normalizedWeekStart, lte: weekEnd },
          completed: true,
        },
        select: { startedAt: true, duration: true },
      }),
    ]);

    // Local-day key so aggregates, energy logs, and focus sessions align even
    // when they were stored at different UTC times of the same day.
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

    const energyByDay = new Map<string, number>();
    for (const e of energyLevels) {
      const key = dayKey(e.date);
      if (!energyByDay.has(key)) energyByDay.set(key, e.energyLevel);
    }

    const focusByDay = new Map<string, number>();
    for (const s of focusSessions) {
      const key = dayKey(s.startedAt);
      focusByDay.set(key, (focusByDay.get(key) ?? 0) + s.duration);
    }

    const workDays = (schedule?.workDays as string[]) ?? [
      "MON",
      "TUE",
      "WED",
      "THU",
      "FRI",
    ];
    const workDayNumbers = getWorkDayNumbers(workDays);

    const workdayAggs = aggregates.filter((agg) =>
      workDayNumbers.includes(new Date(agg.date).getDay()),
    );

    // A workday counts as heavy when the workload is over 1.2 OR the user
    // logged low energy (≤ 4 on the 1-10 scale) OR they pushed 6+ hours of
    // completed deep-focus sessions — any single strain signals risk.
    const isHeavyDay = (agg: (typeof workdayAggs)[number]): boolean => {
      const key = dayKey(new Date(agg.date));
      const dayEnergy = energyByDay.get(key);
      const dayFocus = focusByDay.get(key) ?? 0;
      return (
        agg.workloadScore > 1.2 ||
        (dayEnergy !== undefined && dayEnergy <= 4) ||
        dayFocus >= 360
      );
    };

    const heavyDays = workdayAggs.filter(isHeavyDay);
    const consecutiveHeavyDays = countConsecutiveDays(workdayAggs, isHeavyDay);

    const avgDailyLoad =
      workdayAggs.length > 0
        ? workdayAggs.reduce((sum, agg) => sum + agg.workloadScore, 0) /
          workdayAggs.length
        : 0;

    // ── Energy strain ───────────────────────────────────────────────────────
    // Chronic low energy (multiple low-log days, or an average ≤ 4) is a
    // leading burnout indicator and escalates the effective load.
    const lowEnergyDays = workdayAggs.filter((agg) => {
      const dayEnergy = energyByDay.get(dayKey(new Date(agg.date)));
      return dayEnergy !== undefined && dayEnergy <= 4;
    }).length;

    const energyLogs = workdayAggs
      .map((agg) => energyByDay.get(dayKey(new Date(agg.date))))
      .filter((v): v is number => v !== undefined);
    const avgEnergy =
      energyLogs.length > 0
        ? Math.round((energyLogs.reduce((s, v) => s + v, 0) / energyLogs.length) * 10) / 10
        : null;

    const energyRisk = lowEnergyDays * 0.2 + (avgEnergy !== null && avgEnergy <= 4 ? 0.5 : 0);

    // ── Focus strain ────────────────────────────────────────────────────────
    // Sustained deep-focus overload (6h+ days, or ~4h+ average per workday)
    // compounds the risk even when the task load looks reasonable.
    const focusMinutes = workdayAggs.reduce(
      (sum, agg) => sum + (focusByDay.get(dayKey(new Date(agg.date))) ?? 0),
      0,
    );
    const focusOverloadDays = workdayAggs.filter(
      (agg) => (focusByDay.get(dayKey(new Date(agg.date))) ?? 0) >= 360,
    ).length;
    const avgDailyFocus = workdayAggs.length > 0 ? focusMinutes / workdayAggs.length : 0;

    const focusRisk = focusOverloadDays * 0.3 + (avgDailyFocus >= 240 ? 0.4 : 0);

    // ── Blended risk level ──────────────────────────────────────────────────
    const effectiveAvgLoad = Math.round((avgDailyLoad + energyRisk + focusRisk) * 100) / 100;

    let riskLevel: RiskLevel = "LOW";

    if (consecutiveHeavyDays >= 5 || effectiveAvgLoad > 1.5) {
      riskLevel = "CRITICAL";
    } else if (consecutiveHeavyDays >= 3 || effectiveAvgLoad > 1.2) {
      riskLevel = "HIGH";
    } else if (heavyDays.length >= 2 || effectiveAvgLoad > 1.0) {
      riskLevel = "MODERATE";
    }

    return prisma.burnoutSignal.upsert({
      where: { userId_weekStart: { userId, weekStart: normalizedWeekStart } },
      update: {
        consecutiveHeavyDays,
        avgDailyLoad: effectiveAvgLoad,
        riskLevel,
        avgEnergy,
        lowEnergyDays,
        focusMinutes,
        focusOverloadDays,
      },
      create: {
        userId,
        weekStart: normalizedWeekStart,
        consecutiveHeavyDays,
        avgDailyLoad: effectiveAvgLoad,
        riskLevel,
        avgEnergy,
        lowEnergyDays,
        focusMinutes,
        focusOverloadDays,
      },
    });
  },
};
