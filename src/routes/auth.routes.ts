import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  createTokenPair,
  createSseToken,
  verifyToken,
  extractJti,
  parseExpiry,
  REFRESH_TOKEN_EXPIRY,
} from "../lib/auth/backendToken.js";
import {
  storeRefreshToken,
  storeSseToken,
  rotateRefreshToken,
  revokeAccessToken,
  revokeAllRefreshTokens,
  isSessionRevoked,
} from "../lib/auth/tokenRevocation.js";
import { createSessionMetadata } from "../lib/auth/sessionBinding.js";
import { trackUserSession, revokeUserSession } from "../lib/auth/sessionManager.js";
import {
  recordSessionCreation,
  invalidateSession,
  isSessionTracked,
  isSessionInactive,
} from "../middleware/sessionTimeout.js";
import { auditLog } from "../lib/auth/auditLog.js";
import { acquireRefreshLock, releaseRefreshLock } from "../lib/auth/refreshLock.js";
import { getClientIp } from "../lib/auth/sessionBinding.js";
import { getRedisClient } from "../redis/redis.client.js";
import { rateLimitMiddleware } from "../middleware/rateLimiter.js";

import {
  asyncHandler,
  BadRequestError,
  UnauthorizedError,
  TokenExpiredError,
} from "../errors/index.js";
import { validate } from "../middleware/validate.js";
import { exchangeSchema, refreshSchema, logoutSchema } from "../lib/validation/auth.validation.js";

const router = Router();
// ... (rest of the file)

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_DEDUPE_TTL_SECONDS = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCachedRefreshResponse(cacheKey: string): Promise<string | null> {
  try {
    return await getRedisClient().get(cacheKey);
  } catch {
    return null;
  }
}

async function cacheRefreshResponse(cacheKey: string, payload: string): Promise<void> {
  try {
    await getRedisClient().setex(cacheKey, REFRESH_DEDUPE_TTL_SECONDS, payload);
  } catch {
    // Non-fatal: cache miss on next request is acceptable
  }
}

function verifyExchangeProof(payload: string, signature: string): boolean {
  const secret = process.env.NEXTAUTH_SECRET || 'test-secret-key-for-auth-tests';
  const expected = crypto
    .createHmac("sha256", secret)
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

// ─── POST /exchange ───────────────────────────────────────────────────────────

router.post(
  "/exchange",
  // Per-IP throttle (defense in depth — the frontend already limits logins by
  // IP+email). Fail-open: a Redis outage must never block the token exchange.
  rateLimitMiddleware(60, 60, undefined, { failOpen: true }),
  validate(exchangeSchema, "body"),
  asyncHandler(async (req, res) => {
    const ip = getClientIp(req);
    const { userId, email, role, sessionId, timestamp, signature } = req.body;

    // Proof age check
    const age = Date.now() - Number(timestamp);
    if (age > 60_000 || age < 0) {
      auditLog("EXCHANGE_FAILED", { userId, email, ip, reason: "Proof expired" });
      throw new UnauthorizedError("Exchange proof expired", "PROOF_EXPIRED");
    }

    // Signature check
    const proofPayload = `${userId}${email}${role}${sessionId}${timestamp}`;
    if (!verifyExchangeProof(proofPayload, signature)) {
      auditLog("EXCHANGE_FAILED", { userId, email, ip, reason: "Invalid signature" });
      throw new UnauthorizedError("Invalid exchange proof", "INVALID_PROOF");
    }

    // Idempotency check — return cached tokens for duplicate exchange calls
    const idempotencyKey = `focura:exchange:lock:${sessionId}`;
    try {
      const cached = await getRedisClient().get(idempotencyKey);
      if (cached) {
        auditLog("EXCHANGE_SUCCESS", {
          userId,
          email,
          ip,
          sessionId,
          meta: { idempotencyKey: true },
        });
        return res.json({ success: true, ...JSON.parse(cached) });
      }
    } catch {
      // Redis unavailable — continue without idempotency check
    }

    // User lookup
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, emailVerified: true },
    });

    if (!user) {
      auditLog("EXCHANGE_FAILED", { userId, email, ip, reason: "User not found" });
      throw new UnauthorizedError("User not found", "USER_NOT_FOUND");
    }

    // Email trust check (case-insensitive — emails are canonically lowercase)
    const isEmailTrusted = !!user.emailVerified || user.email.toLowerCase() === email;
    if (!isEmailTrusted) {
      auditLog("EXCHANGE_FAILED", { userId, email, ip, reason: "Email not verified" });
      throw new UnauthorizedError("Email not verified", "EMAIL_NOT_VERIFIED");
    }

    // Auto-verify email on first successful exchange (OAuth flow)
    if (!user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }

    // Issue tokens
    const tokens = createTokenPair({
      id: user.id,
      email: user.email,
      role: user.role,
      sessionId,
    });

    await storeRefreshToken(
      user.id,
      extractJti(tokens.refreshToken),
      parseExpiry(REFRESH_TOKEN_EXPIRY) / 1000,
    );

    // Mint a short-lived, single-use SSE token for the notification stream.
    // It is bound to the user in Redis so the stream can atomically consume
    // it — replaying a used token is rejected (401). Being 30s/one-use, it is
    // safe to pass as a query parameter, unlike the 15-minute access token.
    const sseToken = createSseToken(user.id);
    try {
      await storeSseToken(extractJti(sseToken), user.id);
    } catch (err) {
      // Redis down or rate-limited — the SSE token was minted but won't be
      // consumable. The stream handler will return 503 so the frontend can
      // distinguish this from an auth failure.
      console.warn("[Exchange] Failed to store SSE token (stream will 503):", err);
    }

    // Record the session so the server can enforce inactivity timeout,
    // absolute timeout, session binding (device/IP), and max concurrent
    // sessions. Best-effort: the tokens are already issued and the rest of
    // the auth stack fails open on Redis, so a Redis outage must never turn
    // a successful exchange into a 500.
    try {
      await recordSessionCreation(sessionId);
      await getRedisClient().setex(
        `session:metadata:${sessionId}`,
        7 * 24 * 60 * 60,
        JSON.stringify(createSessionMetadata(req)),
      );
      await trackUserSession(user.id, sessionId);
    } catch (err) {
      console.warn("[Exchange] Failed to record session (non-fatal):", err);
    }

    const tokenPayload = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      sseToken,
      accessTokenExpiry: tokens.accessTokenExpiry,
      refreshTokenExpiry: tokens.refreshTokenExpiry,
    };

    // Cache for idempotency
    try {
      await getRedisClient().setex(idempotencyKey, 90, JSON.stringify(tokenPayload));
    } catch {
      // Non-fatal
    }

    auditLog("EXCHANGE_SUCCESS", { userId: user.id, email: user.email, ip, sessionId });

    return res.json({ success: true, ...tokenPayload });
  }),
);

// ─── POST /refresh ────────────────────────────────────────────────────────────

router.post(
  "/refresh",
  // Generous per-IP limit: silent refresh fires on page loads and tab wakes,
  // so legit bursts are common. Fail-open keeps refreshes working if Redis
  // is down (the auth stack degrades gracefully, not with 429s).
  rateLimitMiddleware(120, 60, undefined, { failOpen: true }),
  validate(refreshSchema, "body"),
  asyncHandler(async (req, res) => {
    const ip = getClientIp(req);
    const { refreshToken } = req.body;

    // Verify the refresh token — let JWT errors bubble to the catch below
    let decoded: ReturnType<typeof verifyToken>;
    try {
      decoded = verifyToken(refreshToken, "refresh");
    } catch (err: any) {
      if (err.name === "TokenExpiredError") throw new TokenExpiredError();
      throw new UnauthorizedError("Invalid refresh token", "INVALID_TOKEN");
    }

    const sessionId = decoded.sessionId!;
    const refreshReplayCacheKey = `focura:refresh:result:${decoded.id}:${decoded.jti}`;

    // Distributed lock — prevents concurrent refresh races
    const acquired = await acquireRefreshLock(sessionId);
    if (!acquired) {
      // Another request holds the lock — poll the cache for its result
      for (let i = 0; i < 10; i++) {
        await sleep(30);
        const cached = await getCachedRefreshResponse(refreshReplayCacheKey);
        if (cached) return res.json(JSON.parse(cached));
      }
      // Lock holder didn't cache in time — ask the client to retry
      return res.status(429).json({
        success: false,
        message: "Refresh in progress, please retry",
        code: "REFRESH_IN_PROGRESS",
        retryAfter: 1,
      });
    }

    try {
      // Check if we already processed this exact token (replay deduplication)
      const cachedResponse = await getCachedRefreshResponse(refreshReplayCacheKey);
      if (cachedResponse) return res.json(JSON.parse(cachedResponse));

      // Server-side session gates: a session that was evicted (max sessions)
      // or idle (inactivity timeout) cannot be resurrected via its refresh
      // token, even though the token itself has not expired.
      if (decoded.sessionId) {
        if (await isSessionRevoked(decoded.sessionId)) {
          auditLog("TOKEN_REVOKED", {
            userId: decoded.id,
            jti: decoded.jti,
            ip,
            sessionId: decoded.sessionId,
            reason: "Session revoked (max sessions reached)",
          });
          throw new UnauthorizedError(
            "Session revoked. Please log in again.",
            "TOKEN_REVOKED",
          );
        }
        const tracked = await isSessionTracked(decoded.sessionId);
        if (tracked && (await isSessionInactive(decoded.sessionId))) {
          auditLog("SESSION_TIMEOUT", {
            userId: decoded.id,
            ip,
            sessionId: decoded.sessionId,
            reason: "Inactivity timeout at refresh",
          });
          throw new UnauthorizedError(
            "Session expired due to inactivity. Please log in again.",
            "SESSION_TIMEOUT",
          );
        }
      }

      const tokens = createTokenPair({
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        sessionId: decoded.sessionId,
      });

      // Fresh single-use SSE token on every rotation — the stream reconnects
      // with the newest one, so a rotated/consumed token never lingers.
      const sseToken = createSseToken(decoded.id);
      try {
        await storeSseToken(extractJti(sseToken), decoded.id);
      } catch (err) {
        console.warn("[Refresh] Failed to store SSE token (stream will 503):", err);
      }

      let rotated: boolean;
      try {
        rotated = await rotateRefreshToken(
          decoded.id,
          decoded.jti,
          extractJti(tokens.refreshToken),
          parseExpiry(REFRESH_TOKEN_EXPIRY) / 1000,
        );
      } catch (err) {
        // Redis is unavailable (rate-limited, down, etc.). Fail open: issue
        // new tokens anyway so the user stays logged in. The old refresh
        // token can't be revoked from Redis, but it will expire naturally
        // in 7 days. This prevents the false TOKEN_REPLAY_DETECTED that was
        // logging users out after 15 minutes when Upstash hit its quota.
        console.warn("[Refresh] Redis unavailable during rotation (fail-open):", err);
        rotated = true;
      }

      if (!rotated) {
        // Rotation returned false (not threw) → old token genuinely not in
        // Redis → real replay or already-rotated. Wait briefly in case a
        // concurrent request is mid-cache.
        for (let i = 0; i < 3; i++) {
          await sleep(75);
          const duplicateResponse = await getCachedRefreshResponse(refreshReplayCacheKey);
          if (duplicateResponse) return res.json(JSON.parse(duplicateResponse));
        }

        auditLog("TOKEN_REPLAY_DETECTED", {
          userId: decoded.id,
          jti: decoded.jti,
          ip,
          reason: "Refresh token already used or revoked",
        });

        throw new UnauthorizedError(
          "Refresh token invalid or already used",
          "TOKEN_REPLAY_DETECTED",
        );
      }

      const responsePayload = {
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        sseToken,
        accessTokenExpiry: tokens.accessTokenExpiry,
        refreshTokenExpiry: tokens.refreshTokenExpiry,
      };

      await cacheRefreshResponse(refreshReplayCacheKey, JSON.stringify(responsePayload));

      auditLog("TOKEN_REFRESHED", { userId: decoded.id, ip, sessionId: decoded.sessionId });

      return res.json(responsePayload);
    } finally {
      await releaseRefreshLock(sessionId);
    }
  }),
);

// ─── POST /logout ─────────────────────────────────────────────────────────────
// Logout is always best-effort — it must never fail the client even if Redis
// is down or the token is already invalid. So we don't use asyncHandler here.

router.post(
  "/logout",
  // Cheap to enforce, harmless when Redis is down (fail-open).
  rateLimitMiddleware(60, 60, undefined, { failOpen: true }),
  validate(logoutSchema, "body"),
  async (req, res) => {
  const ip = getClientIp(req);
  const { logoutAll } = req.body;

  let userId: string | undefined;
  let tokenJti: string | undefined;
  let sessionId: string | undefined;
  let email: string | undefined;

  // Extract identity from the access token if present — failure is non-fatal
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = verifyToken(authHeader.slice(7).trim(), "access");
      userId = decoded.id;
      tokenJti = decoded.jti;
      sessionId = decoded.sessionId;
      email = decoded.email;
    } catch {
      // Expired or invalid token is fine here — we're logging out anyway
    }
  }

  // Revoke tokens — best effort, don't block the response on Redis failure
  try {
    if (tokenJti) await revokeAccessToken(tokenJti, 900);
    if (logoutAll && userId) await revokeAllRefreshTokens(userId);
    if (sessionId) {
      await invalidateSession(sessionId);
      if (userId) await revokeUserSession(userId, sessionId);
    }
  } catch (err) {
    console.error("Token revocation error during logout:", err);
  }

  auditLog(logoutAll ? "LOGOUT_ALL_DEVICES" : "LOGOUT", {
    userId,
    email,
    ip,
    sessionId,
  });

  return res.json({
    success: true,
    message: logoutAll ? "Logged out from all devices" : "Logged out successfully",
  });
});

export default router;