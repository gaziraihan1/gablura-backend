import { prisma } from '../../lib/prisma.js';
import type { GetFocusHistoryInput } from './focusSession.types.js';
import { sessionWithSlimTask, sessionWithIdTitle } from './focusSession.selects.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const FocusSessionQuery = {
  async getActiveSession(userId: string) {
    const cacheKey = CACHE_KEYS.focusActiveSession(userId);
    
    const cached = await CacheClient.get<any>(cacheKey);
    if (cached) return cached;

    const session = await prisma.focusSession.findFirst({
      where: {
        userId,
        completed: false,
        endedAt:   null,
      },
      include: sessionWithSlimTask,
      orderBy: { startedAt: 'desc' },
    });

    // Cache even if null (no active session) with short TTL
    await CacheClient.set(cacheKey, session, CACHE_TTL.FOCUS_ACTIVE_SESSION);
    return session;
  },

  async getHistory(input: GetFocusHistoryInput) {
    const limit = input.limit ?? 30;
    const cacheKey = CACHE_KEYS.focusSessionHistory(input.userId, limit);
    
    const cached = await CacheClient.get<any[]>(cacheKey);
    if (cached) return cached;

    const sessions = await prisma.focusSession.findMany({
      where: {
        userId:    input.userId,
        completed: true,
      },
      include: sessionWithIdTitle,
      orderBy: { startedAt: 'desc' },
      take:    limit,
    });

    await CacheClient.set(cacheKey, sessions, CACHE_TTL.FOCUS_SESSION_HISTORY);
    return sessions;
  },
};