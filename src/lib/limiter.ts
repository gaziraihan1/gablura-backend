import { getRedisClient } from "../redis/redis.client.js";

export interface RateLimitResult {
  success: boolean;
  reset?: number;
  remaining?: number;
  limit?: number;
}

const USER_TIER_LIMITS = { free: 60, pro: 300, enterprise: 1000 } as const;

// Sliding-window limiter backed by the shared ioredis client — the backend's
// single Redis client (the former Upstash REST client was consolidated away).
class RedisRateLimiter {
  async limit(key: string, customLimit = 60): Promise<RateLimitResult> {
    const now = Date.now(),
      window = 60_000,
      windowStart = now - window,
      limitKey = `focura:rl:${key}`;
    const pipeline = getRedisClient().pipeline();
    pipeline.zremrangebyscore(limitKey, 0, windowStart);
    pipeline.zcard(limitKey);
    pipeline.zadd(limitKey, now, `${now}:${Math.random()}`);
    pipeline.expire(limitKey, 60);
    // ioredis resolves exec() as [err, result][] tuples — zcard is index 1.
    const results = await pipeline.exec();
    const [, zcardResult] = results?.[1] ?? [];
    const count = typeof zcardResult === "number" ? zcardResult : 0;
    return {
      success: count < customLimit,
      remaining: Math.max(0, customLimit - count - 1),
      reset: now + window,
      limit: customLimit,
    };
  }
}

class DevRateLimiter {
  private store = new Map<string, number[]>();
  async limit(key: string, customLimit = 60): Promise<RateLimitResult> {
    const now = Date.now(),
      windowStart = now - 60_000;
    const timestamps = (this.store.get(key) ?? []).filter(
      (ts) => ts > windowStart,
    );
    const count = timestamps.length,
      success = count < customLimit;
    if (success) timestamps.push(now);
    this.store.set(key, timestamps);
    return {
      success,
      remaining: Math.max(0, customLimit - count - 1),
      reset: now + 60_000,
      limit: customLimit,
    };
  }
}

const limiterInstance =
  process.env.NODE_ENV === "production"
    ? new RedisRateLimiter()
    : new DevRateLimiter();

export async function limitApiRequest(
  userId: string,
  userTier: keyof typeof USER_TIER_LIMITS = "free",
): Promise<RateLimitResult> {
  return limiterInstance.limit(`user:${userId}`, USER_TIER_LIMITS[userTier]);
}
