import { getRedisClient } from "../redis/redis.client.js";

export interface RateLimitResult {
  success: boolean;
  reset?: number;
  remaining?: number;
  limit?: number;
}

const USER_TIER_LIMITS = { free: 60, pro: 300, enterprise: 1000 } as const;

// Calendar routes are intentionally bursty: a single calendar page load fans
// out to ~15–20 parallel requests (aggregates across 4 date ranges, insights,
// goals, system events, capacity, schedule, energy, burnout trends, ...).
// They get their own per-user bucket with higher limits so the page's burst
// never starves the rest of the dashboard (tasks, projects, workspaces, ...)
// which share the shared `user:{id}` bucket above.
const USER_TIER_CALENDAR_LIMITS = { free: 120, pro: 600, enterprise: 2000 } as const;

export type ApiTier = keyof typeof USER_TIER_LIMITS;

// Billing plan → API rate-limit tier. BUSINESS and ENTERPRISE share the top
// tier — mirrors the AI limiter (src/modules/ai/ai.types.ts), which treats
// them identically.
const PLAN_TO_API_TIER: Record<string, ApiTier> = {
  FREE: "free",
  PRO: "pro",
  BUSINESS: "enterprise",
  ENTERPRISE: "enterprise",
};

const tierCache = new Map<string, { tier: ApiTier; expiresAt: number }>();
const TIER_CACHE_TTL_MS = 60_000;

/**
 * Resolve the API rate-limit tier for a user from their highest billing plan
 * (60s in-memory cache, so plan changes take effect within a minute). Unknown
 * plans fall back to the free tier.
 *
 * Deliberately USER-LEVEL: the tier follows the user's highest OWNED workspace
 * plan, not the workspace a given request operates in. A user who owns a PRO
 * workspace gets the pro bucket everywhere — including FREE workspaces where
 * they are only a member — and membership alone never raises the tier. This is
 * intentionally different from the AI limiter (src/modules/ai/ai.ratelimit.ts),
 * which resolves per-request workspace context; do not align them without a
 * product decision.
 *
 * Tier resolution is best-effort: when the plan cannot be determined (billing
 * service unavailable), the most conservative tier is applied rather than
 * failing the request. The actual rate-limit check below is still fail-closed.
 */
export async function resolveUserApiTier(userId: string): Promise<ApiTier> {
  const cached = tierCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  try {
    const { BillingService } = await import("../modules/billing/billing.service.js");
    const plan = await BillingService.getUserHighestPlan(userId);
    const tier = PLAN_TO_API_TIER[plan] ?? "free";
    tierCache.set(userId, { tier, expiresAt: Date.now() + TIER_CACHE_TTL_MS });
    return tier;
  } catch {
    return "free";
  }
}

// Sliding-window limiter backed by the shared ioredis client — the backend's
// single Redis client (the former Upstash REST client was consolidated away).
class RedisRateLimiter {
  async limit(key: string, customLimit = 60): Promise<RateLimitResult> {
    const now = Date.now(),
      window = 60_000,
      windowStart = now - window,
      limitKey = `gablura:rl:${key}`;
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
  userTier: ApiTier = "free",
): Promise<RateLimitResult> {
  return limiterInstance.limit(`user:${userId}`, USER_TIER_LIMITS[userTier]);
}

/**
 * Calendar-scoped per-user limiter. Uses a separate sliding-window bucket
 * (`user:{id}:calendar`) so the calendar page's request burst never consumes
 * the shared per-user API bucket used by the rest of the dashboard.
 */
export async function limitCalendarRequest(
  userId: string,
  userTier: ApiTier = "free",
): Promise<RateLimitResult> {
  return limiterInstance.limit(
    `user:${userId}:calendar`,
    USER_TIER_CALENDAR_LIMITS[userTier],
  );
}
