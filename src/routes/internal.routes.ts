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
import { validate } from "../middleware/validate.js";
import {
  failedAttemptSchema,
  clearAttemptsSchema,
  auditEventSchema,
  revokeSessionsSchema,
  internal2FAVerifySchema,
  internal2FACheckSchema,
} from "../lib/validation/internal.validation.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// Internal (backend-to-backend) routes — mounted at /api/v1/internal.
//
// These endpoints exist so the Next.js server (which owns the credentials
// flow) can talk to services that live in the Express backend: the
// Redis-backed account lockout, the audit log, and session revocation.
// They are intentionally NOT part of the user-facing API.
// ═══════════════════════════════════════════════════════════════════════════

// Audit event whitelist is enforced by auditEventSchema (internal.validation.ts)

/**
 * Verify a short-lived HMAC proof. The Next.js server signs the request body
 * (minus timestamp/signature) with NEXTAUTH_SECRET — the same shared secret
 * the /exchange proof uses — so no extra env var is required on the frontend.
 */
function verifyInternalProof(req: Request): boolean {
  const body: Record<string, unknown> = req.body ?? {};
  const { timestamp, signature } = body;
  if (typeof timestamp !== "number" || typeof signature !== "string") {
    console.error("[internal] Missing or invalid timestamp/signature fields", {
      hasBody: !!req.body,
      bodyKeys: Object.keys(body ?? {}),
      timestampType: typeof timestamp,
      signatureType: typeof signature,
    });
    return false;
  }
  if (!process.env.NEXTAUTH_SECRET) {
    console.error("[internal] NEXTAUTH_SECRET not configured");
    return false;
  }
  // Proof must be fresh (< 60s) to bound replayability of the signed payload.
  const age = Date.now() - timestamp;
  if (age > 60_000 || age < 0) {
    console.error("[internal] Timestamp expired or future", { age, timestamp, now: Date.now() });
    return false;
  }

  const { signature: _s, ...fields } = body;
  const payload = JSON.stringify(fields);
  const secret = process.env.NEXTAUTH_SECRET!;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  try {
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    const match = crypto.timingSafeEqual(sigBuf, expBuf);
    if (!match) {
      console.error("[internal] HMAC mismatch", {
        secretLen: secret.length,
        secretBytes: [...Buffer.from(secret)].slice(0, 4),
        payload: payload.substring(0, 200),
        expected: expected.substring(0, 16),
        got: signature.substring(0, 16),
      });
    }
    return match;
  } catch (err) {
    console.error("[internal] HMAC comparison error:", err);
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

router.post("/failed-attempt", validate(failedAttemptSchema, "body"), asyncHandler(async (req, res) => {
  const { email } = req.body;
  // ACCOUNT_LOCKED is a critical transition event — emit it only when this
  // attempt actually creates the lock, not on every repeat hit while locked.
  const wasLocked = (await isAccountLocked(email)).locked;
  const result = await recordFailedAttempt(email);
  if (result.locked && !wasLocked) {
    auditLog("ACCOUNT_LOCKED", { email, reason: "Too many failed attempts" });
  }
  return res.json({ success: true, ...result });
}));

router.post("/clear-attempts", validate(clearAttemptsSchema, "body"), asyncHandler(async (req, res) => {
  const { email } = req.body;
  await clearFailedAttempts(email);
  return res.json({ success: true });
}));

// Login audit events from the Next.js credentials/OAuth flow. Fire-and-forget:
// the caller must never be blocked or failed by audit persistence.
router.post("/audit", validate(auditEventSchema, "body"), asyncHandler(async (req, res) => {
  const { event, userId, email, ip, userAgent, reason, meta } = req.body;
  auditLog(event as AuditEventType, { userId, email, ip, userAgent, reason, meta });
  return res.json({ success: true });
}));

// Revoke EVERY session for a user (used after a password reset). Best-effort:
// the password has already been rotated by the caller, so Redis failures must
// never make the reset appear to fail.
router.post("/revoke-sessions", validate(revokeSessionsSchema, "body"), asyncHandler(async (req, res) => {
  const { email } = req.body;
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
  validate(internal2FAVerifySchema, "body"),
  asyncHandler(async (req, res) => {
    const { userId, totpCode } = req.body;
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
    const markerKey = `gablura:2fa:verified:${userId}`;
    try {
      await getRedisClient().setex(markerKey, 600, "1");
    } catch (err) {
      // Transient Redis failures are common — retry once after a short delay
      console.warn("[2fa-verify] Redis setex failed, retrying in 500ms:", err);
      try {
        await new Promise((r) => setTimeout(r, 500));
        await getRedisClient().setex(markerKey, 600, "1");
      } catch (retryErr) {
        console.error("[2fa-verify] Redis setex retry also failed:", retryErr);
        return res.status(503).json({ success: false, error: "Verification service unavailable. Please try again." });
      }
    }
    return res.json({ success: true });
  }),
);

router.post("/2fa-check", validate(internal2FACheckSchema, "body"), asyncHandler(async (req, res) => {
  const { userId } = req.body;
  let verified = false;
  try {
    verified = (await getRedisClient().exists(`gablura:2fa:verified:${userId}`)) === 1;
  } catch {
    // Redis down → fail closed: 2FA must never be skipped.
  }
  return res.json({ success: true, verified });
}));

export default router;
