import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  createTokenPair,
  verifyToken,
  extractJti,
  parseExpiry,
  REFRESH_TOKEN_EXPIRY,
} from "../lib/auth/backendToken.js";
import {
  storeRefreshToken,
  rotateRefreshToken,
  revokeAccessToken,
  revokeAllRefreshTokens,
} from "../lib/auth/tokenRevocation.js";
import { auditLog } from "../lib/auth/auditLog.js";
import { redis } from "../lib/redis.js";

const router = Router();
const devRefreshResponseCache = new Map<string, string>();
const REFRESH_DEDUPE_TTL_SECONDS = 30;

import {
  acquireRefreshLock,
  releaseRefreshLock,
} from "../lib/auth/refreshLock.js";

const getIp = (req: any) =>
  (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
  req.socket.remoteAddress ||
  "unknown";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCachedRefreshResponse(cacheKey: string) {
  if (redis && process.env.UPSTASH_REDIS_REST_URL) {
    try {
      return await redis.get<string>(cacheKey);
    } catch (error) {
      console.error('Redis get error:', error);
      return devRefreshResponseCache.get(cacheKey) ?? null;
    }
  }
  return devRefreshResponseCache.get(cacheKey) ?? null;
}

async function cacheRefreshResponse(cacheKey: string, payload: string) {
  if (redis && process.env.UPSTASH_REDIS_REST_URL) {
    try {
      await redis.setex(cacheKey, REFRESH_DEDUPE_TTL_SECONDS, payload);
      return;
    } catch (error) {
      console.error('Redis setex error:', error);
      // Fallback to in-memory
    }
  }
  
  // In-memory fallback
  devRefreshResponseCache.set(cacheKey, payload);
  setTimeout(
    () => devRefreshResponseCache.delete(cacheKey),
    REFRESH_DEDUPE_TTL_SECONDS * 1000,
  );
}

function verifyExchangeProof(payload: string, signature: string): boolean {
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

router.post("/exchange", async (req, res) => {
  const ip = getIp(req);
  try {
    const { userId, email, role, sessionId, timestamp, signature } = req.body;

    if (!userId || !email || !role || !sessionId || !timestamp || !signature) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
        code: "MISSING_FIELDS",
      });
    }

    const age = Date.now() - Number(timestamp);
    if (age > 60_000 || age < 0) {
      auditLog("EXCHANGE_FAILED", {
        userId,
        email,
        ip,
        reason: "Proof expired",
      });
      return res.status(401).json({
        success: false,
        message: "Exchange proof expired",
        code: "PROOF_EXPIRED",
      });
    }

    const payload = `${userId}${email}${role}${sessionId}${timestamp}`;
    if (!verifyExchangeProof(payload, signature)) {
      auditLog("EXCHANGE_FAILED", {
        userId,
        email,
        ip,
        reason: "Invalid signature",
      });
      return res.status(401).json({
        success: false,
        message: "Invalid exchange proof",
        code: "INVALID_PROOF",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, emailVerified: true },
    });

    if (!user) {
      auditLog("EXCHANGE_FAILED", {
        userId,
        email,
        ip,
        reason: "User not found",
      });
      return res.status(401).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    const isEmailTrusted = !!user.emailVerified || user.email === email;

    if (!isEmailTrusted) {
      auditLog("EXCHANGE_FAILED", {
        userId,
        email,
        ip,
        reason: "Email not verified",
      });
      return res.status(401).json({
        success: false,
        message: "Email not verified",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const idempotencyKey = `focura:exchange:lock:${sessionId}`;
    
    // Only use Redis if properly configured
    if (redis && process.env.UPSTASH_REDIS_REST_URL) {
      try {
        const cached = await redis.get<string>(idempotencyKey);
        if (cached) {
          auditLog("EXCHANGE_SUCCESS", {
            userId: user.id,
            email: user.email,
            ip,
            sessionId,
            meta: { idempotencyKey: true },
          });
          return res.json({ success: true, ...JSON.parse(cached) });
        }
      } catch (error) {
        console.error('Redis idempotency check error:', error);
        // Continue without idempotency check
      }
    }

    if (!user.emailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date() },
      });
    }

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
    
    // Store idempotency cache if Redis available
    if (redis && process.env.UPSTASH_REDIS_REST_URL) {
      try {
        await redis.setex(
          idempotencyKey,
          90,
          JSON.stringify({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            accessTokenExpiry: tokens.accessTokenExpiry,
            refreshTokenExpiry: tokens.refreshTokenExpiry,
          }),
        );
      } catch (error) {
        console.error('Redis idempotency set error:', error);
        // Continue without caching
      }
    }

    auditLog("EXCHANGE_SUCCESS", {
      userId: user.id,
      email: user.email,
      ip,
      sessionId,
    });

    return res.json({
      success: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessTokenExpiry: tokens.accessTokenExpiry,
      refreshTokenExpiry: tokens.refreshTokenExpiry,
    });
  } catch (err) {
    console.error("Exchange error:", err);
    auditLog("EXCHANGE_FAILED", { ip, reason: (err as Error).message });
    return res.status(500).json({
      success: false,
      message: "Exchange failed",
      code: "EXCHANGE_ERROR",
    });
  }
});

router.post("/refresh", async (req, res) => {
  const ip = getIp(req);
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res
        .status(400)
        .json({ success: false, message: "Refresh token required" });
    }

    const decoded = verifyToken(refreshToken, "refresh");
    const sessionId = decoded.sessionId!;
    const refreshReplayCacheKey = `focura:refresh:result:${decoded.id}:${decoded.jti}`;
    
    const acquired = await acquireRefreshLock(sessionId);
    if (!acquired) {
      // In-flight refresh: extended cache check
      for (let i = 0; i < 10; i++) {
        await sleep(30);
        const cached = await getCachedRefreshResponse(refreshReplayCacheKey);
        if (cached) return res.json(JSON.parse(cached));
      }
      return res.status(429).json({
        success: false,
        message: "Refresh in progress, please retry",
        code: "REFRESH_IN_PROGRESS",
        retryAfter: 1,
      });
    }
    
    const cachedResponse = await getCachedRefreshResponse(
      refreshReplayCacheKey,
    );
    if (cachedResponse) {
      await releaseRefreshLock(sessionId);
      return res.json(JSON.parse(cachedResponse));
    }

    try {
      const tokens = createTokenPair({
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        sessionId: decoded.sessionId,
      });
      
      const rotated = await rotateRefreshToken(
        decoded.id,
        decoded.jti,
        extractJti(tokens.refreshToken),
        parseExpiry(REFRESH_TOKEN_EXPIRY) / 1000,
      );
  
      if (!rotated) {
        for (let i = 0; i < 3; i++) {
          await sleep(75);
          const duplicateResponse = await getCachedRefreshResponse(
            refreshReplayCacheKey,
          );
          if (duplicateResponse) {
            await releaseRefreshLock(sessionId);
            return res.json(JSON.parse(duplicateResponse));
          }
        }
  
        auditLog("TOKEN_REPLAY_DETECTED", {
          userId: decoded.id,
          jti: decoded.jti,
          ip,
          reason: "Refresh token already used or revoked",
        });
        
        await releaseRefreshLock(sessionId);
        return res.status(401).json({
          success: false,
          message: "Refresh token invalid or already used",
          code: "TOKEN_INVALID",
        });
      }
  
      const responsePayload = {
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessTokenExpiry: tokens.accessTokenExpiry,
        refreshTokenExpiry: tokens.refreshTokenExpiry,
      };
      
      await cacheRefreshResponse(
        refreshReplayCacheKey,
        JSON.stringify(responsePayload),
      );
  
      auditLog("TOKEN_REFRESHED", {
        userId: decoded.id,
        ip,
        sessionId: decoded.sessionId,
      });
      
      return res.json(responsePayload);
    } finally {
      await releaseRefreshLock(sessionId);
    }

  } catch (err: any) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Refresh token expired",
        code: "TOKEN_EXPIRED",
      });
    }
    return res.status(401).json({
      success: false,
      message: "Token refresh failed",
      code: "REFRESH_FAILED",
    });
  }
});

router.post("/logout", async (req, res) => {
  const ip = getIp(req);
  const { logoutAll = false } = req.body ?? {};

  let userId: string | undefined;
  let tokenJti: string | undefined;
  let sessionId: string | undefined;
  let email: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = verifyToken(authHeader.slice(7).trim(), "access");
      userId = decoded.id;
      tokenJti = decoded.jti;
      sessionId = decoded.sessionId;
      email = decoded.email;
    } catch {}
  }

  try {
    if (process.env.UPSTASH_REDIS_REST_URL && redis) {
      try {
        if (tokenJti) await revokeAccessToken(tokenJti, 900);
        if (logoutAll && userId) await revokeAllRefreshTokens(userId);
      } catch (error) {
        console.error('Redis revocation error:', error);
        // Continue with logout
      }
    }

    auditLog(logoutAll ? "LOGOUT_ALL_DEVICES" : "LOGOUT", {
      userId,
      email,
      ip,
      sessionId,
    });

    return res.json({
      success: true,
      message: logoutAll
        ? "Logged out from all devices"
        : "Logged out successfully",
    });
  } catch (err) {
    console.error("Logout error:", err);
    return res.json({ success: true, message: "Logged out" });
  }
});

export default router;