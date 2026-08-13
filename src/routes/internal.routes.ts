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

function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  // Accept either the dedicated x-internal-secret header (for server tooling
  // that holds INTERNAL_AUTH_SECRET) or the HMAC proof used by Next.js.
  const secret = req.headers["x-internal-secret"];
  if (
    secret &&
    process.env.INTERNAL_AUTH_SECRET &&
    secret === process.env.INTERNAL_AUTH_SECRET
  ) {
    return next();
  }
  if (verifyInternalProof(req)) return next();
  return res.status(401).json({ success: false, message: "Unauthorized" });
}

router.use(requireInternalSecret);

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

export default router;
