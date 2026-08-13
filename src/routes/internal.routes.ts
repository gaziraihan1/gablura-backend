import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import {
  clearFailedAttempts,
  isAccountLocked,
  recordFailedAttempt,
} from "../lib/auth/accountLockout.js";
import { auditLog, AuditEventType } from "../lib/auth/auditLog.js";
import {
  markSessionRevoked,
  revokeAllRefreshTokens,
} from "../lib/auth/tokenRevocation.js";
import {
  getUserActiveSessions,
  revokeUserSession,
} from "../lib/auth/sessionManager.js";
import { prisma } from "../lib/prisma.js";
import { verifyTOTPToken } from "../lib/totp.js";
import { rateLimitMiddleware } from "../middleware/rateLimiter.js";
import { getRedisClient } from "../redis/redis.client.js";
import { asyncHandler } from "../errors/index.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// Internal (backend-to-backend) routes — mounted at /api/v1/internal.
//
// These endpoints exist so the Next.js server (which owns the credentials
// flow) can talk to services that live in the Express backend: the
// Redis-backed account lockout, the audit log, and session revocation.
// They are intentionally NOT part of the user-facing API.
// ═══════════════════════════════════════════════════════════════════════════

// Audit events the Next.js server may emit. Everything else is rejected so a
// compromised Next.js server cannot forge arbitrary audit entries.
const INTERNAL_AUDIT_EVENTS: readonly string[] = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGIN_BLOCKED",
  "ACCOUNT_LOCKED",
];

/**
 * Verify a short-lived HMAC proof. The Next.js server signs the request body
 * (minus timestamp/signature) with NEXTAUTH_SECRET — the same shared secret
 * the /exchange proof uses — so no extra env var is required on the frontend.
 */
function verifyInternalProof(req: Request): boolean {
  const body: Record<string, unknown> = req.body ?? {};
  const { timestamp, signature } = body;
  if (typeof timestamp !== "number" || typeof signature !== "string") {
    return false;
  }
  if (!process.env.NEXTAUTH_SECRET) {
    return false; // no shared secret configured — reject rather than throw
  }
  // Proof must be fresh (< 60s) to bound replayability of the signed payload.
  const age = Date.now() - timestamp;
  if (age > 60_000 || age < 0) return false;

  const { timestamp: _t, signature: _s, ...fields } = body;
  const payload = JSON.stringify(fields);
  const expected = crypto
    .createHmac("sha256", process.env.NEXTAUTH_SECRET!)
    .update(payload)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    );
  } catch {
    return false;
  }
}

function requireInternalProof(req: Request, res: Response, next: NextFunction) {
  // HMAC proof only — signed with the NEXTAUTH_SECRET the Next.js server
  // already shares with /exchange. No static header credential to rotate or
  // leak; a missing shared secret rejects cleanly instead of throwing.
  if (verifyInternalProof(req)) return next();
  return res.status(401).json({ success: false, message: "Unauthorized" });
}

router.use(requireInternalProof);

router.post("/failed-attempt", asyncHandler(async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ success: false, message: "Email is required" });
  // ACCOUNT_LOCKED is a critical transition event — emit it only when this
  // attempt actually creates the lock, not on every repeat hit while locked.
  const wasLocked = (await isAccountLocked(email)).locked;
  const result = await recordFailedAttempt(email);
  if (result.locked && !wasLocked) {
    auditLog("ACCOUNT_LOCKED", { email, reason: "Too many failed attempts" });
  }
  return res.json({ success: true, ...result });
}));

router.post("/clear-attempts", asyncHandler(async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ success: false, message: "Email is required" });
  await clearFailedAttempts(email);
  return res.json({ success: true });
}));

// Login audit events from the Next.js credentials/OAuth flow. Fire-and-forget:
// the caller must never be blocked or failed by audit persistence.
router.post("/audit", asyncHandler(async (req, res) => {
  const { event, userId, email, ip, userAgent, reason, meta } = req.body ?? {};
  if (!event || !INTERNAL_AUDIT_EVENTS.includes(event)) {
    return res.status(400).json({ success: false, message: "Unsupported audit event" });
  }
  auditLog(event as AuditEventType, { userId, email, ip, userAgent, reason, meta });
  return res.json({ success: true });
}));

// Revoke EVERY session for a user (used after a password reset). Best-effort:
// the password has already been rotated by the caller, so Redis failures must
// never make the reset appear to fail.
router.post("/revoke-sessions", asyncHandler(async (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ success: false, message: "Email is required" });
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (user) {
    await revokeAllRefreshTokens(user.id);
    const sessions = await getUserActiveSessions(user.id);
    for (const session of sessions) {
      await markSessionRevoked(session.sessionId);
      await revokeUserSession(user.id, session.sessionId);
    }
    auditLog("SESSIONS_REVOKED", {
      userId: user.id,
      email,
      meta: { reason: "password_reset", count: sessions.length },
    });
  }
  return res.json({ success: true });
}));

// ─── Google sign-in 2FA completion ──────────────────────────────────────────
// The Next.js server verifies the TOTP locally (clean user-facing errors) and
// calls /2fa-verify to mint a short-lived Redis marker; the NextAuth jwt
// callback consumes it via /2fa-check when the session updates. Fail-closed:
// a Redis outage must NOT make 2FA appear verified.
router.post(
  "/2fa-verify",
  // Per-user throttle — an attacker rotating IPs still hits the same bucket.
  rateLimitMiddleware(10, 60, (req) => (req.body as { userId?: string })?.userId),
  asyncHandler(async (req, res) => {
    const { userId, totpCode } = req.body ?? {};
    if (
      typeof userId !== "string" ||
      !userId ||
      typeof totpCode !== "string" ||
      !totpCode.trim()
    ) {
      return res.status(400).json({ success: false, error: "userId and totpCode are required" });
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, twoFactorEnabled: true, twoFactorSecret: true },
    });
    if (!user?.twoFactorSecret) {
      return res.status(400).json({ success: false, error: "Two-factor authentication is not configured" });
    }
    const valid = await verifyTOTPToken(totpCode.trim(), user.twoFactorSecret);
    auditLog(valid ? "TOTP_VERIFIED" : "TOTP_FAILED", {
      userId,
      email: user.email,
      reason: "Google sign-in 2FA",
    });
    if (!valid) {
      return res.status(400).json({ success: false, error: "Invalid verification code. Please try again." });
    }
    try {
      await getRedisClient().setex(`focura:2fa:verified:${userId}`, 600, "1");
    } catch (err) {
      console.error("[2fa-verify] Failed to set Redis marker:", err);
      return res.status(503).json({ success: false, error: "Verification service unavailable. Please try again." });
    }
    return res.json({ success: true });
  }),
);

router.post("/2fa-check", asyncHandler(async (req, res) => {
  const { userId } = req.body ?? {};
  if (typeof userId !== "string" || !userId) {
    return res.status(400).json({ success: false, verified: false });
  }
  let verified = false;
  try {
    verified = (await getRedisClient().exists(`focura:2fa:verified:${userId}`)) === 1;
  } catch {
    // Redis down → fail closed: 2FA must never be skipped.
  }
  return res.json({ success: true, verified });
}));

export default router;
