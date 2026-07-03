import { getRedisClient } from "../../redis/redis.client.js";
import { auditLog } from "./auditLog.js";

const MAX_CONCURRENT_SESSIONS = 5;

export async function trackUserSession(
  userId: string,
  sessionId: string,
  // deviceInfo: string,
): Promise<void> {
  const redis = getRedisClient();
  const key = `user:sessions:${userId}`;
  const members = await redis.smembers(key);

  if (members.length >= MAX_CONCURRENT_SESSIONS) {
    auditLog("MAX_SESSIONS_REACHED", {
      userId,
      meta: { sessionCount: members.length, limit: MAX_CONCURRENT_SESSIONS },
    });
    const oldestSession = members[0];
    await redis.srem(key, oldestSession);
    await redis.del(`session:metadata:${oldestSession}`);
  }

  await redis.sadd(key, sessionId);
  await redis.expire(key, 7 * 24 * 60 * 60);
}

export async function revokeUserSession(userId: string, sessionId: string): Promise<void> {
  const redis = getRedisClient();
  const key = `user:sessions:${userId}`;
  await redis.srem(key, sessionId);
  await redis.del(`session:metadata:${sessionId}`);
}

export async function getUserActiveSessions(
  userId: string,
): Promise<Array<{ sessionId: string; deviceInfo: string; lastActivity: string }>> {
  const redis = getRedisClient();
  const key = `user:sessions:${userId}`;
  const sessionIds = await redis.smembers(key);

  const sessions = [];
  for (const sessionId of sessionIds) {
    const metadata = await redis.get(`session:metadata:${sessionId}`);
    if (metadata) {
      try {
        const parsed = JSON.parse(metadata);
        sessions.push({
          sessionId,
          deviceInfo: parsed.userAgent,
          lastActivity: new Date(parsed.lastActivity).toISOString(),
        });
      } catch {
        // Skip session if metadata is corrupted
      }
    }
  }

  return sessions;
}