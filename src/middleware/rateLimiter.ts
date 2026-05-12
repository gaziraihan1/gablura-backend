import { Request, Response, NextFunction } from "express";
import { getRedisClient } from "../redis/redis.client.js";

export const rateLimitMiddleware = (max = 100, windowSeconds = 60) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim()
      || req.ip
      || "unknown";
    const key = `rl:backend:${ip}`;

    try {
      const redis = getRedisClient();
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;
      const member = `${now}:${Math.random()}`;

      const pipe = redis.pipeline();
      pipe.zremrangebyscore(key, 0, windowStart);
      pipe.zcard(key);
      pipe.zadd(key, now, member); // ioredis: zadd(key, score, member)
      pipe.expire(key, windowSeconds);
      const results = await pipe.exec();

      const count = (results?.[1]?.[1] as number) ?? 0;

      if (count >= max) {
        return res.status(429).json({ error: "Too many requests", retryAfter: windowSeconds });
      }

      next();
    } catch (error) {
      console.error("Rate limit error:", error);
      next();
    }
  };
};