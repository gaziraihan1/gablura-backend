import { getRedisClient } from "../redis/redis.client.js";

// Sliding-window limiter (10 requests / 10 minutes) backed by the shared
// ioredis client — the backend's single Redis client (the former Upstash
// REST client was consolidated away).
const MAX_REQUESTS = 10;
const WINDOW_SECONDS = 600;

export const ratelimit = {
  async limit(identifier: string): Promise<{
    success: boolean;
    remaining: number;
    reset: number;
  }> {
    const redis = getRedisClient();
    const now = Date.now();
    const windowStart = now - WINDOW_SECONDS * 1000;
    const key = `gablura:ratelimit:${identifier}`;

    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, now, `${now}:${Math.random()}`);
    pipeline.expire(key, WINDOW_SECONDS);
    // ioredis resolves exec() as [err, result][] tuples — zcard is index 1.
    const results = await pipeline.exec();
    const [, zcardResult] = results?.[1] ?? [];
    const count = typeof zcardResult === "number" ? zcardResult : 0;

    return {
      success: count < MAX_REQUESTS,
      remaining: Math.max(0, MAX_REQUESTS - count - 1),
      reset: windowStart + WINDOW_SECONDS * 1000,
    };
  },
};
