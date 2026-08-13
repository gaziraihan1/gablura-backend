import { Request, Response, NextFunction } from "express";
import { getRedisClient } from "../redis/redis.client.js";
import { getClientIp } from "../lib/auth/sessionBinding.js";

export interface RateLimitOptions {
  /**
   * When true, a Redis failure lets the request through instead of rejecting
   * with 429. Used on auth endpoints, where the documented posture is to fail
   * open on Redis outages — a login or token refresh must never be blocked
   * because the rate limiter itself is down.
   */
  failOpen?: boolean;
}

export const rateLimitMiddleware = (
  max = 100,
  windowSeconds = 60,
  keyFn?: (req: Request) => string | undefined,
  options: RateLimitOptions = {},
) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Trust-proxy-computed req.ip (the rightmost X-Forwarded-For entry from
    // the trusted hop) — the first XFF entry is client-spoofable, so rate
    // limit buckets are never keyed off it.
    const ip = getClientIp(req);
    // Per-user keying (used on 2FA endpoints) beats per-IP: an attacker who
    // rotates IPs still hits the same user bucket once the target id is known.
    const userKey = keyFn?.(req);
    const key = userKey ? `rl:user:${userKey}` : `rl:backend:${ip}`;

    try {
      const redis = getRedisClient();
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;
      const member = `${now}:${Math.random()}`;

      const pipe = redis.pipeline();
      pipe.zremrangebyscore(key, 0, windowStart);
      pipe.zadd(key, now, member); // Add current request first
      pipe.zcard(key);            // Then count total including current
      pipe.expire(key, windowSeconds);
      const results = await pipe.exec();

      // results is an array of [err, result] tuples for each command in the pipeline
      // zcard is the 3rd command (index 2)
      const [, zcardResult] = results?.[2] || [];

      const count = typeof zcardResult === "number" ? zcardResult : 0;

      if (count > max) {
        return res.status(429).json({ success: false, message: "Too many requests", code: "RATE_LIMIT_EXCEEDED", retryAfter: windowSeconds });
      }

      next();
    } catch (error) {
      console.error("Rate limit error:", error);
      if (options.failOpen) {
        // Fail open: the limiter must never block auth requests when Redis
        // is unavailable — the rest of the auth stack degrades gracefully.
        next();
        return;
      }
      // Fail closed: reject when rate limiting can't be verified
      return res.status(429).json({ success: false, message: "Rate limit service unavailable", code: "RATE_LIMIT_SERVICE_UNAVAILABLE", retryAfter: windowSeconds });
    }
  };
};