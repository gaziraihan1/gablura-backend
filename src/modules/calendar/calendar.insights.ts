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

    const [aggregates, capacity, schedule] = await Promise.all([
      CalendarAggregation.getOrComputeAggregates({
        userId,
        workspaceId,
        startDate,
        endDate,
      }),
      prisma.userCapacity.findUnique({ where: { userId } }),
      prisma.userWorkSchedule.findUnique({ where: { userId } }),
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

    const result = {
      totalPlannedHours,
      totalCapacityHours,
      commitmentGap,
      overloadedDays,
      focusDays,
      burnoutRisk: burnoutSignal.riskLevel,
      timeAllocation: null, // null until real category tracking is implemented
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
      workDayNumbers.includes(agg.date.getDay()),
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
