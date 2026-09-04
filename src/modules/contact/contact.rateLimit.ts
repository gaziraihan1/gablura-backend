import { Request, Response, NextFunction } from "express";
import { getRedisClient } from "../../redis/redis.client.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRealIp(req: Request): string {
  // Trusted IP: the RIGHTMOST X-Forwarded-For entry is the one the trusted
  // proxy appended; earlier entries are client-spoofable. Falls back to the
  // socket address.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const entries = forwarded
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (entries.length > 0) return entries[entries.length - 1];
  }
  return req.socket.remoteAddress ?? "unknown";
}

async function slidingWindowLimit(
  key: string,
  tokens: number,
  windowSeconds: number,
): Promise<{ success: boolean; reset: number }> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;
  const limitKey = `gablura:contact:${key}`;

  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(limitKey, 0, windowStart);
  pipeline.zcard(limitKey);
  pipeline.zadd(limitKey, now, `${now}:${Math.random()}`);
  pipeline.expire(limitKey, windowSeconds);
  // ioredis resolves exec() as [err, result][] tuples — zcard is index 1.
  const results = await pipeline.exec();
  const [, zcardResult] = results?.[1] ?? [];
  const count = typeof zcardResult === "number" ? zcardResult : 0;

  return {
    success: count < tokens,
    reset: windowStart + windowSeconds * 1000,
  };
}

// ─── Middleware ──────────────────────────────────────────────────────────────
export async function contactRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Same pattern as the auth/CSRF helpers — never block in tests.
  if (process.env.NODE_ENV === "test") {
    return next();
  }

  try {
    const ip = getRealIp(req);

    // ── IP check: 3 requests / hour ──────────────────────────────────────
    const ipResult = await slidingWindowLimit(`ip:${ip}`, 3, 3600);

    if (!ipResult.success) {
      const minutes = Math.ceil((ipResult.reset - Date.now()) / 60000);

      res.status(429).json({
        success: false,
        error: "TOO_MANY_REQUESTS",
        message: `Too many requests. Try again in ${minutes} minute${
          minutes !== 1 ? "s" : ""
        }.`,
      });
      return;
    }

    // ── Email check: 2 requests / 24 hours ───────────────────────────────
    const email: string | undefined = req.body?.email?.toLowerCase?.().trim();

    if (email) {
      const emailResult = await slidingWindowLimit(`email:${email}`, 2, 86400);

      if (!emailResult.success) {
        const hours = Math.ceil((emailResult.reset - Date.now()) / 3600000);

        res.status(429).json({
          success: false,
          error: "TOO_MANY_REQUESTS",
          message: `Email limit reached. Try again in ${hours} hour${
            hours !== 1 ? "s" : ""
          }.`,
        });
        return;
      }
    }

    next();
  } catch (err) {
    // Fail closed: reject when the limiter can't be verified.
    console.warn(
      "[contactRateLimit] Rate limiter unavailable — rejecting request",
      err,
    );
    res.status(429).json({
      success: false,
      error: "RATE_LIMIT_UNAVAILABLE",
      message:
        "Rate limiting service is temporarily unavailable. Please try again later.",
    });
  }
}
