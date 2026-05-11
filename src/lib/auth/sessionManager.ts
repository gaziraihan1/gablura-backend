import { redis } from '../redis.js';
import { auditLog } from './auditLog.js';

const MAX_CONCURRENT_SESSIONS = 5;

export async function trackUserSession(
  userId: string,
  sessionId: string,
  deviceInfo: string
): Promise<void> {
  if (!redis) return;

  const key = `user:sessions:${userId}`;
  const sessions = await redis.smembers<string[]>(key);

  if (sessions && sessions.length >= MAX_CONCURRENT_SESSIONS) {
    auditLog('MAX_SESSIONS_REACHED', {
  userId,
  meta: {
    sessionCount: sessions.length,
    limit: MAX_CONCURRENT_SESSIONS,
  },
});

    const oldestSession = sessions[0];
    await redis.srem(key, oldestSession);
    await redis.del(`session:metadata:${oldestSession}`);
  }

  await redis.sadd(key, sessionId);
  await redis.expire(key, 7 * 24 * 60 * 60); // 7 days
}

export async function revokeUserSession(
  userId: string,
  sessionId: string
): Promise<void> {
  if (!redis) return;

  const key = `user:sessions:${userId}`;
  await redis.srem(key, sessionId);
  await redis.del(`session:metadata:${sessionId}`);
}

export async function getUserActiveSessions(
  userId: string
): Promise<Array<{ sessionId: string; deviceInfo: string; lastActivity: string }>> {
  if (!redis) return [];

  const key = `user:sessions:${userId}`;
  const sessionIds = await redis.smembers<string[]>(key);

  if (!sessionIds) return [];

  const sessions = [];
  for (const sessionId of sessionIds) {
    const metadata = await redis.get<string>(`session:metadata:${sessionId}`);
    if (metadata) {
      const parsed = JSON.parse(metadata);
      sessions.push({
        sessionId,
        deviceInfo: parsed.userAgent,
        lastActivity: new Date(parsed.lastActivity).toISOString(),
      });
    }
  }

  return sessions;
}