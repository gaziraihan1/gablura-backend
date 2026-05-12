import { getRedisClient } from "../../redis/redis.client.js";

const MAX_FAILURES    = 10;
const LOCKOUT_SECONDS = 15 * 60;
const WINDOW_SECONDS  = 60 * 60;
const PREFIX          = "focura:lockout";

export async function recordFailedAttempt(
  identifier: string,
): Promise<{ locked: boolean; unlocksAt?: Date; attempts: number }> {
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
}

export async function clearFailedAttempts(identifier: string): Promise<void> {
  const redis = getRedisClient();
  await redis.del(
    `${PREFIX}:failures:${identifier}`,
    `${PREFIX}:locked:${identifier}`,
  );
}

export async function isAccountLocked(
  identifier: string,
): Promise<{ locked: boolean; unlocksAt?: Date }> {
  const redis = getRedisClient();
  const lockedUntil = await redis.get(`${PREFIX}:locked:${identifier}`);
  if (!lockedUntil) return { locked: false };
  return { locked: true, unlocksAt: new Date(Number(lockedUntil)) };
}