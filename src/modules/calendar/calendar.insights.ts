import { prisma } from "../../lib/prisma.js";
import type { BurnoutSignal, CalendarInsights } from "./calendar.types.js";
import type { RiskLevel } from "./calendar.types.js";
import { CalendarAggregation } from "./calendar.aggregation.js";
import {
  normalizeDate,
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

    const [aggregates, schedule] = await Promise.all([
      CalendarAggregation.getOrComputeAggregates({
        userId,
        startDate: normalizedWeekStart,
        endDate: weekEnd,
      }),
      prisma.userWorkSchedule.findUnique({ where: { userId } }),
    ]);

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

    const heavyDays = workdayAggs.filter((agg) => agg.workloadScore > 1.2);
    const consecutiveHeavyDays = countConsecutiveDays(
      workdayAggs,
      (agg) => agg.workloadScore > 1.2,
    );
    const avgDailyLoad =
      workdayAggs.length > 0
        ? workdayAggs.reduce((sum, agg) => sum + agg.workloadScore, 0) /
          workdayAggs.length
        : 0;

    let riskLevel: RiskLevel = "LOW";

    if (consecutiveHeavyDays >= 5 || avgDailyLoad > 1.5) {
      riskLevel = "CRITICAL";
    } else if (consecutiveHeavyDays >= 3 || avgDailyLoad > 1.2) {
      riskLevel = "HIGH";
    } else if (heavyDays.length >= 2 || avgDailyLoad > 1.0) {
      riskLevel = "MODERATE";
    }

    return prisma.burnoutSignal.upsert({
      where: { userId_weekStart: { userId, weekStart: normalizedWeekStart } },
      update: { consecutiveHeavyDays, avgDailyLoad, riskLevel },
      create: {
        userId,
        weekStart: normalizedWeekStart,
        consecutiveHeavyDays,
        avgDailyLoad,
        riskLevel,
      },
    });
  },
};
