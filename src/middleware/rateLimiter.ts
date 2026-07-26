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
      pipe.zadd(key, now, member); // Add current request first
      pipe.zcard(key);            // Then count total including current
      pipe.expire(key, windowSeconds);
      const results = await pipe.exec();

      // results is an array of [err, result] tuples for each command in the pipeline
      // zcard is the 3rd command (index 2)
      const [err, zcardResult] = results?.[2] || [];

      const count = typeof zcardResult === "number" ? zcardResult : 0;

      if (count > max) {
        return res.status(429).json({ success: false, message: "Too many requests", code: "RATE_LIMIT_EXCEEDED", retryAfter: windowSeconds });
      }

      next();
    } catch (error) {
      console.error("Rate limit error:", error);
      // Fail closed: reject when rate limiting can't be verified
      return res.status(429).json({ success: false, message: "Rate limit service unavailable", code: "RATE_LIMIT_SERVICE_UNAVAILABLE", retryAfter: windowSeconds });
    }
  };
};