
import { prisma } from '../../lib/prisma.js';
import type { SystemCalendarEvent, GoalCheckpoint } from './calendar.types.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

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
};