import { Request, Response, NextFunction } from "express";
import { redis } from "../../lib/redis.js";

// ─── Lazy loader for Ratelimit (mirrors auth helper pattern) ──────────────────
async function getRatelimitSafe() {
  try {
    const mod = await import("@upstash/ratelimit");
    return mod.Ratelimit;
  } catch {
    return null;
  }
}

// ─── Safe limiter creator ─────────────────────────────────────────────────────
async function createLimiterSafe(config: {
  tokens: number;
  window: string;
  prefix: string;
}) {
  const Ratelimit = await getRatelimitSafe();

  if (!Ratelimit) return null;

  // Try modern API
  if (typeof (Ratelimit as any).slidingWindow === "function") {
    return new Ratelimit({
      redis,
      limiter: (Ratelimit as any).slidingWindow(config.tokens, config.window),
      prefix: config.prefix,
    });
  }

  // If API mismatch → disable limiter (like CSRF fallback)
  return null;
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function getRealIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

// ─── Middleware ──────────────────────────────────────────────────────────────
export async function contactRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // ✅ Same pattern as your auth/CSRF helpers
  if (process.env.NODE_ENV === "test") {
    return next();
  }

  const ipLimiter = await createLimiterSafe({
    tokens: 3,
    window: "1 h",
    prefix: "focura:contact:ip",
  });

  const emailLimiter = await createLimiterSafe({
    tokens: 2,
    window: "24 h",
    prefix: "focura:contact:email",
  });

  // If limiter unavailable → fail closed (reject to prevent abuse)
  if (!ipLimiter) {
    console.warn("[contactRateLimit] Rate limiter unavailable — rejecting request");
    res.status(429).json({
      success: false,
      error: "RATE_LIMIT_UNAVAILABLE",
      message: "Rate limiting service is temporarily unavailable. Please try again later.",
    });
    return;
  }

  const ip = getRealIp(req);

  // ── IP check ─────────────────────────────────────────────────────────────
  const ipResult = await ipLimiter.limit(ip);

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

  // ── Email check ──────────────────────────────────────────────────────────
  const email: string | undefined = req.body?.email?.toLowerCase?.().trim();

  if (email && emailLimiter) {
    const emailResult = await emailLimiter.limit(email);

    if (!emailResult.success) {
      const hours = Math.ceil(
        (emailResult.reset - Date.now()) / 3600000
      );

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
}