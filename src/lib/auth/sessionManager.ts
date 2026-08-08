import { getRedisClient } from "../../redis/redis.client.js";
import { markSessionRevoked } from "./tokenRevocation.js";
import { auditLog } from "./auditLog.js";

const MAX_CONCURRENT_SESSIONS = 5;

export async function trackUserSession(
  userId: string, sessionId: string,
): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `user:sessions:${userId}`;
    const members = await redis.smembers(key);

    if (members.length >= MAX_CONCURRENT_SESSIONS) {
      auditLog("MAX_SESSIONS_REACHED", {
        userId,
        meta: { sessionCount: members.length, limit: MAX_CONCURRENT_SESSIONS },
      });
      // Redis SETs have no ordering — evict the session with the oldest
      // recorded activity so a genuinely active session is never revoked.
      const evictedSession = await pickLeastActiveSession(redis, members);
      await redis.srem(key, evictedSession);
      await redis.del(`session:metadata:${evictedSession}`);
      // Tombstone the evicted session so its (still valid) tokens can no
      // longer authenticate or refresh.
      await markSessionRevoked(evictedSession);
    }

    await redis.sadd(key, sessionId);
    await redis.expire(key, 7 * 24 * 60 * 60);
  } catch (err) {
    console.error(`[SessionManager] Failed to track session for user ${userId}:`, err);
  }
}

async function pickLeastActiveSession(
  redis: { get: (key: string) => Promise<string | null> },
  members: string[],
): Promise<string> {
  let leastActive = members[0];
  let leastActiveAt = Infinity;
  for (const member of members) {
    let lastActivity = 0;
    try {
      const meta = await redis.get(`session:metadata:${member}`);
      if (meta) lastActivity = JSON.parse(meta).lastActivity ?? 0;
    } catch {
      lastActivity = 0;
    }
    if (lastActivity < leastActiveAt) {
      leastActiveAt = lastActivity;
      leastActive = member;
    }
  }
  return leastActive;
}

export async function revokeUserSession(userId: string, sessionId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `user:sessions:${userId}`;
    await redis.srem(key, sessionId);
    await redis.del(`session:metadata:${sessionId}`);
  } catch (err) {
    console.error(`[SessionManager] Failed to revoke session for user ${userId}:`, err);
  }
}

export async function getUserActiveSessions(
  userId: string,
): Promise<
    Array<{
      sessionId: string;
      deviceInfo: string;
      ipAddress?: string;
      lastActivity: string;
      createdAt: string;
    }>
  > {
  try {
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
            deviceInfo: parsed.userAgent ?? "",
            ipAddress: parsed.ipAddress,
            lastActivity: new Date(parsed.lastActivity).toISOString(),
            createdAt: new Date(parsed.createdAt ?? parsed.lastActivity).toISOString(),
          });
        } catch {
          console.warn(`[SessionManager] Corrupted session metadata for session ${sessionId}, skipping`);
        }
      }
    }

    return sessions;
  } catch (err) {
    console.error(`[SessionManager] Failed to get sessions for user ${userId}:`, err);
    return [];
  }
}
