import type { NextFunction, Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { getRedisClient } from "../../redis/redis.client.js";
import { prisma } from "../../lib/prisma.js";
import { BillingService } from "../billing/billing.service.js";
import { AI_PLAN_LIMITS, type AiPlan } from "./ai.types.js";

/**
 * ⭐ Tier-based AI rate limiting (FREE / PRO / BUSINESS).
 *
 * General API limiters are not enough — AI calls cost real money per token.
 * This middleware enforces, per workspace (or per user for personal flows):
 *
 *   1. Burst  — sorted-set sliding window (60 s)      → spike protection
 *   2. Hourly — sorted-set sliding window (3 600 s)   → sustained hammering
 *   3. Daily  — INCR + EXPIRE (calendar day)          → plan allowance
 *
 * It is fail-closed: if Redis is unreachable we reject with 429 instead of
 * silently spending money. It also exposes `X-AI-RateLimit-*` headers so the
 * client can show remaining credits.
 */

const PLAN_CACHE_TTL_MS = 60_000;
const planCache = new Map<string, { plan: AiPlan; expiresAt: number }>();

/** Resolve the effective AI plan for a workspace (60s in-memory cache). */
export async function resolveWorkspacePlan(workspaceId: string): Promise<AiPlan> {
  const cached = planCache.get(workspaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.plan;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });

  const raw = workspace?.plan as AiPlan | undefined;
  const plan: AiPlan = raw && AI_PLAN_LIMITS[raw] ? raw : "FREE";

  planCache.set(workspaceId, { plan, expiresAt: Date.now() + PLAN_CACHE_TTL_MS });
  return plan;
}

/** Resolve the effective AI plan for a user's personal (workspace-less) flows. */
export async function resolveUserPlan(userId: string): Promise<AiPlan> {
  const highest = await BillingService.getUserHighestPlan(userId);
  const plan = highest as AiPlan;
  return AI_PLAN_LIMITS[plan] ? plan : "FREE";
}

interface AiScope {
  /** Redis-scope id — `ws:<workspaceId>` or `usr:<userId>`. */
  id: string;
  workspaceId?: string;
}

export function getAiScope(req: AuthRequest): AiScope {
  const workspaceId = (req.body?.workspaceId ??
    req.query?.workspaceId ??
    req.params?.workspaceId) as string | undefined;

  if (workspaceId) return { id: `ws:${workspaceId}`, workspaceId };
  return { id: `usr:${req.user!.id}` };
}

export const aiRateLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const scope = getAiScope(req);
    const plan = scope.workspaceId
      ? await resolveWorkspacePlan(scope.workspaceId)
      : await resolveUserPlan(req.user!.id);

    const limits = AI_PLAN_LIMITS[plan];
    const id = scope.id;
    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);

    const redis = getRedisClient();

    // Layer 1 & 2 — sliding windows (mirrors src/middleware/rateLimiter.ts)
    const checkWindow = async (key: string, windowMs: number, max: number): Promise<number> => {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, now - windowMs);
      pipeline.zadd(key, now, `${now}:${Math.random()}`);
      pipeline.zcard(key);
      pipeline.expire(key, Math.ceil(windowMs / 1000));
      const results = await pipeline.exec();
      return Number((results?.[2]?.[1] as number) ?? 0);
    };

    const burstCount = await checkWindow(
      `focura:ai:rl:min:${id}`,
      60_000,
      limits.burstPerMinute,
    );
    if (burstCount > limits.burstPerMinute) {
      sendTooMany(res, plan, 60, "AI_RATE_LIMIT_EXCEEDED");
      return;
    }

    const hourCount = await checkWindow(
      `focura:ai:rl:hour:${id}`,
      3_600_000,
      limits.hourly,
    );
    if (hourCount > limits.hourly) {
      sendTooMany(res, plan, 3600, "AI_RATE_LIMIT_EXCEEDED");
      return;
    }

    // Layer 3 — daily request quota (idempotent reset at midnight)
    const dailyKey = `focura:ai:q:daily:${today}:${id}`;
    const dailyCount = await redis.incr(dailyKey);
    if (dailyCount === 1) await redis.expire(dailyKey, 60 * 60 * 25);
    if (dailyCount > limits.daily) {
      sendTooMany(res, plan, 3600, "AI_DAILY_QUOTA_EXCEEDED");
      return;
    }

    res.locals.aiPlan = plan;
    res.setHeader("X-AI-RateLimit-Plan", plan);
    res.setHeader("X-AI-RateLimit-Limit", String(limits.daily));
    res.setHeader(
      "X-AI-RateLimit-Remaining",
      String(Math.max(0, limits.daily - dailyCount)),
    );
    res.setHeader("X-AI-RateLimit-Reset", String(60 * 60));

    next();
  } catch (error) {
    console.error("[AiRateLimit]", error);
    // Fail closed: don't call the LLM when we cannot verify quota.
    res.status(429).json({
      success: false,
      message: "AI quota service unavailable. Please try again later.",
      code: "AI_RATE_LIMIT_SERVICE_UNAVAILABLE",
      retryAfter: 60,
    });
  }
};

function sendTooMany(
  res: Response,
  plan: AiPlan,
  retryAfter: number,
  code: "AI_RATE_LIMIT_EXCEEDED" | "AI_DAILY_QUOTA_EXCEEDED",
): void {
  res.status(429).json({
    success: false,
    message:
      plan === "FREE"
        ? "You've hit the free AI limit. Upgrade to Pro for more AI usage."
        : "AI rate limit exceeded. Please try again later.",
    code,
    plan,
    retryAfter,
    // The client renders the upgrade CTA itself — it knows the workspace slug
    // and links to `/dashboard/workspaces/<slug>/billing/upgrade`. Sending a
    // hard-coded personal settings URL here would send users to a dead end.
  });
}
