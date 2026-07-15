
import { prisma } from '../../lib/prisma.js';
import type {
  SystemCalendarEvent,
  GoalCheckpoint,
  EnergyLevel,
  BurnoutTrend,
  UserCapacityData,
  UserWorkScheduleData,
  PaginatedResult,
} from './calendar.types.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

function paginate(page = 1, limit = 31) {
  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));
  return { page: p, limit: l, skip: (p - 1) * l };
}

function buildPagination(page: number, limit: number, total: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    page, limit, total, totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

export const CalendarQuery = {
  async getSystemEvents(
    userId: string,
    workspaceId: string | undefined,
    startDate: Date,
    endDate: Date,
  ): Promise<SystemCalendarEvent[]> {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const cacheKey = CACHE_KEYS.calendarSystemEvents(userId, workspaceId, startDateStr, endDateStr);
    
    const cached = await CacheClient.get<SystemCalendarEvent[]>(cacheKey);
    if (cached) return cached;

    const events = await prisma.systemCalendarEvent.findMany({
      where: {
        OR: [{ userId }, { workspaceId }],
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });

    await CacheClient.set(cacheKey, events, CACHE_TTL.CALENDAR_SYSTEM_EVENTS);
    return events;
  },

  async getGoalCheckpoints(
    userId: string,
    workspaceId: string | undefined,
    startDate: Date,
    endDate: Date,
  ): Promise<GoalCheckpoint[]> {
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const cacheKey = CACHE_KEYS.calendarGoalCheckpoints(userId, workspaceId, startDateStr, endDateStr);
    
    const cached = await CacheClient.get<GoalCheckpoint[]>(cacheKey);
    if (cached) return cached;

    const goals = await prisma.goalCheckpoint.findMany({
      where: {
        userId,
        ...(workspaceId ? { workspaceId } : {}),
        targetDate: { gte: startDate, lte: endDate },
      },
      orderBy: { targetDate: 'asc' },
    });

    await CacheClient.set(cacheKey, goals, CACHE_TTL.CALENDAR_GOAL_CHECKPOINTS);
    return goals;
  },

  async getUserCapacity(userId: string): Promise<UserCapacityData | null> {
    const cacheKey = CACHE_KEYS.calendarCapacity(userId);
    const cached = await CacheClient.get<UserCapacityData>(cacheKey);
    if (cached) return cached;

    const capacity = await prisma.userCapacity.findUnique({ where: { userId } });
    if (!capacity) return null;

    const result = {
      weeklyHours:        capacity.weeklyHours,
      dailyCapacityHours: capacity.dailyCapacityHours,
      deepWorkHours:      capacity.deepWorkHours,
    };

    await CacheClient.set(cacheKey, result, CACHE_TTL.CALENDAR_CAPACITY);
    return result;
  },

  async getUserSchedule(userId: string): Promise<UserWorkScheduleData | null> {
    const cacheKey = CACHE_KEYS.calendarSchedule(userId);
    const cached = await CacheClient.get<UserWorkScheduleData>(cacheKey);
    if (cached) return cached;

    const schedule = await prisma.userWorkSchedule.findUnique({ where: { userId } });
    if (!schedule) return null;

    const result = {
      workDays:      schedule.workDays as string[],
      workStartHour: schedule.workStartHour,
      workEndHour:   schedule.workEndHour,
      timezone:      schedule.timezone ?? undefined,
    };

    await CacheClient.set(cacheKey, result, CACHE_TTL.CALENDAR_SCHEDULE);
    return result;
  },

  async getEnergyLevel(userId: string, date: Date): Promise<EnergyLevel | null> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dateStr = dayStart.toISOString().split('T')[0];
    const cacheKey = CACHE_KEYS.calendarEnergyLevel(userId, dateStr);

    const cached = await CacheClient.get<EnergyLevel>(cacheKey);
    if (cached) return cached;

    const entry = await prisma.energyLevel.findUnique({
      where: { userId_date: { userId, date: dayStart } },
    });

    if (entry) {
      await CacheClient.set(cacheKey, entry, CACHE_TTL.CALENDAR_ENERGY_LEVEL);
    }

    return entry;
  },

  async getEnergyHistory(userId: string, startDate: Date, endDate: Date, page = 1, limit = 31): Promise<PaginatedResult<EnergyLevel>> {
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    const cacheKey = CACHE_KEYS.calendarEnergyHistory(userId, startStr, endStr);

    const { page: p, limit: l, skip } = paginate(page, limit);

    const cached = await CacheClient.get<PaginatedResult<EnergyLevel>>(cacheKey);
    if (cached) return cached;

    const where = { userId, date: { gte: startDate, lte: endDate } };

    const [data, total] = await Promise.all([
      prisma.energyLevel.findMany({
        where,
        orderBy: { date: 'desc' },
        skip,
        take: l,
      }),
      prisma.energyLevel.count({ where }),
    ]);

    const result: PaginatedResult<EnergyLevel> = {
      data,
      pagination: buildPagination(p, l, total),
    };

    await CacheClient.set(cacheKey, result, CACHE_TTL.CALENDAR_ENERGY_HISTORY);
    return result;
  },

  async getBurnoutTrends(userId: string, weeks: number): Promise<BurnoutTrend[]> {
    const cacheKey = CACHE_KEYS.calendarBurnoutTrends(userId, weeks);
    const cached = await CacheClient.get<BurnoutTrend[]>(cacheKey);
    if (cached) return cached;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - weeks * 7);

    const signals = await prisma.burnoutSignal.findMany({
      where: { userId, weekStart: { gte: startDate } },
      orderBy: { weekStart: 'asc' },
    });

    const result = signals.map(s => ({
      weekStart:           s.weekStart.toISOString().split('T')[0],
      riskLevel:           s.riskLevel,
      consecutiveHeavyDays: s.consecutiveHeavyDays,
      avgDailyLoad:        s.avgDailyLoad,
    }));

    await CacheClient.set(cacheKey, result, CACHE_TTL.CALENDAR_BURNOUT_TRENDS);
    return result;
  },

  async getTimeAllocation(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<{ category: string; totalMinutes: number }[]> {
    // Use DB-level groupBy instead of fetching all rows into JS memory
    const groups = await prisma.timeEntry.groupBy({
      by:      ["category"],
      where:   { userId, startedAt: { gte: startDate, lte: endDate } },
      _sum:    { duration: true },
      orderBy: { _sum: { duration: "desc" } },
    });

    return groups.map((g) => ({
      category:    g.category.toLowerCase(),
      totalMinutes: g._sum.duration ?? 0,
    }));
  },
};