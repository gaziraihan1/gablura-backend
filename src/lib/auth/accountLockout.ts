import { getRedisClient } from "../../redis/redis.client.js";

const MAX_FAILURES    = 10;
const LOCKOUT_SECONDS = 15 * 60;
const WINDOW_SECONDS  = 60 * 60;
const PREFIX          = "gablura:lockout";

export async function recordFailedAttempt(
  identifier: string,
): Promise<{ locked: boolean; unlocksAt?: Date; attempts: number }> {
  try {
    const redis = getRedisClient();
    const failKey = `${PREFIX}:failures:${identifier}`;
    const lockKey = `${PREFIX}:locked:${identifier}`;

    const existingLock = await redis.get(lockKey);
    if (existingLock) {
      return { locked: true, unlocksAt: new Date(Number(existingLock)), attempts: MAX_FAILURES };
    }

    const pipe = redis.pipeline();
    pipe.incr(failKey);
    pipe.expire(failKey, WINDOW_SECONDS);
    const results = await pipe.exec();
    const attempts = (results?.[0]?.[1] as number) ?? 1;

    if (attempts >= MAX_FAILURES) {
      const unlocksAt = Date.now() + LOCKOUT_SECONDS * 1000;
      await redis.setex(lockKey, LOCKOUT_SECONDS, String(unlocksAt));
      return { locked: true, unlocksAt: new Date(unlocksAt), attempts };
    }

    return { locked: false, attempts };
  } catch (err) {
    console.error("[AccountLockout] Failed to record failed attempt:", err);
    return { locked: false, attempts: 0 }; // Fail open: don't lock if Redis is down
  }
}

export async function clearFailedAttempts(identifier: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(
      `${PREFIX}:failures:${identifier}`,
      `${PREFIX}:locked:${identifier}`,
    );
  } catch (err) {
    console.error("[AccountLockout] Failed to clear failed attempts:", err);
  }
}

export async function isAccountLocked(
  identifier: string,
): Promise<{ locked: boolean; unlocksAt?: Date }> {
  try {
    const redis = getRedisClient();
    const lockedUntil = await redis.get(`${PREFIX}:locked:${identifier}`);
    if (!lockedUntil) return { locked: false };
    return { locked: true, unlocksAt: new Date(Number(lockedUntil)) };
  } catch (err) {
    console.error("[AccountLockout] Failed to check account lock status:", err);
    return { locked: false }; // Fail open: don't block if Redis is down
  }
}
