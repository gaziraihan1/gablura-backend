import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth.js";
import type { ApiTier } from "../lib/limiter.js";

/**
 * Per-user API rate limiting for the core CRUD routes (tasks, projects,
 * workspaces, comments, focus sessions).
 *
 * `rateLimitByUser(tier)` accepts either a static tier or a resolver function
 * that returns the tier for the request (used to honor the user's billing
 * plan). Buckets are keyed off the authenticated user id — one sliding window
 * per user shared across every route the middleware guards, so rotating IPs
 * never bypass the limit and one user's traffic never consumes another's.
 *
 * Fail-closed: if the limiter cannot be verified (Redis down), the request is
 * rejected with 429 rather than let abuse through unchecked.
 */
export const rateLimitByUser = (
  tier?: ApiTier | ((req: AuthRequest) => Promise<ApiTier> | ApiTier),
) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) return next();

    try {
      const { limitApiRequest } = await import("../lib/limiter.js");
      const resolvedTier = typeof tier === "function" ? await tier(req) : tier;
      const result = await limitApiRequest(req.user.id, resolvedTier || "free");

      res.setHeader("X-RateLimit-Limit", result.limit ?? 60);
      res.setHeader("X-RateLimit-Remaining", result.remaining ?? 0);
      if (result.reset) res.setHeader("X-RateLimit-Reset", result.reset.toString());

      if (!result.success) {
        const retryAfter = result.reset ? Math.ceil((result.reset - Date.now()) / 1000) : 60;
        return res.status(429).json({ success: false, message: "Rate limit exceeded. Please try again later.", code: "RATE_LIMIT_EXCEEDED", retryAfter });
      }

      next();
    } catch (err) {
      console.error("Rate limit error:", err);
      // Fail closed: reject when rate limiting can't be verified
      const retryAfter = 60;
      return res.status(429).json({ success: false, message: "Rate limit service unavailable. Please try again later.", code: "RATE_LIMIT_SERVICE_UNAVAILABLE", retryAfter });
    }
  };
};

/**
 * Ready-to-mount limiter for the core CRUD routes. Resolves the user's
 * highest billing plan to a tier (FREE → 60/min, PRO → 300/min, BUSINESS /
 * ENTERPRISE → 1000/min) with a 60s cache, then enforces the per-user
 * sliding-window bucket.
 */
export const rateLimitUserApi = rateLimitByUser(async (req: AuthRequest) => {
  const { resolveUserApiTier } = await import("../lib/limiter.js");
  return resolveUserApiTier(req.user!.id);
});
