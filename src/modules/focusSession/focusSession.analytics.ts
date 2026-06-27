
import { prisma } from '../../lib/prisma.js';
import type { GetFocusStatsInput, FocusStats } from './focusSession.types.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const FocusSessionAnalytics = {
  async getStats(input: GetFocusStatsInput): Promise<FocusStats> {
    const startDateStr = input.startDate?.toISOString().split('T')[0] ?? 'all';
    const endDateStr = input.endDate?.toISOString().split('T')[0] ?? 'all';
    const cacheKey = CACHE_KEYS.focusSessionStats(input.userId, startDateStr, endDateStr);
    
    const cached = await CacheClient.get<FocusStats>(cacheKey);
    if (cached) return cached;

    const where = {
      userId:    input.userId,
      completed: true,
      ...(input.startDate && input.endDate
        ? { startedAt: { gte: input.startDate, lte: input.endDate } }
        : {}),
    };

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [sessionCount, durationAgg, completedToday] = await Promise.all([
      prisma.focusSession.count({ where }),

      prisma.focusSession.aggregate({
        where,
        _sum: { duration: true },
      }),

      prisma.focusSession.count({
        where: {
          userId:    input.userId,
          completed: true,
          startedAt: { gte: todayStart, lte: todayEnd },
        },
      }),
    ]);

    const totalMinutes = durationAgg._sum.duration ?? 0;

    const result = {
      totalSessions:         sessionCount,
      totalMinutes,
      completedToday,
      averageSessionLength:  sessionCount > 0 ? totalMinutes / sessionCount : 0,
    };

    await CacheClient.set(cacheKey, result, CACHE_TTL.FOCUS_SESSION_STATS);
    return result;
  },

  async getFocusStreak(userId: string): Promise<number> {
    const cacheKey = CACHE_KEYS.focusSessionStreak(userId);
    
    const cached = await CacheClient.get<number>(cacheKey);
    if (cached !== null) return cached;

    const sessions = await prisma.focusSession.findMany({
      where:   { userId, completed: true },
      select:  { startedAt: true },
      orderBy: { startedAt: 'desc' },
    });

    if (sessions.length === 0) {
      await CacheClient.set(cacheKey, 0, CACHE_TTL.FOCUS_SESSION_STREAK);
      return 0;
    }

    const sessionDates = new Set(
      sessions.map((s) => s.startedAt.toISOString().split('T')[0]),
    );

    let streak = 0;
    const cursor = new Date();
    const cursorUTC = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()));

    while (true) {
      const key = cursorUTC.toISOString().split('T')[0];
      if (!sessionDates.has(key)) break;
      streak++;
      cursorUTC.setUTCDate(cursorUTC.getUTCDate() - 1);
    }

    await CacheClient.set(cacheKey, streak, CACHE_TTL.FOCUS_SESSION_STREAK);
    return streak;
  },
};