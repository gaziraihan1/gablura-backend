import { Request, Response, NextFunction } from "express";
import jwt, {JwtPayload} from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma.js";
import { getRedisClient } from "../redis/redis.client.js";
import { getClientIp, generateDeviceFingerprint, isPrivateIp, looksLikeServerToServerRequest, looksLikeServerToServerUA, SessionMetadata, validateSessionBinding } from "../lib/auth/sessionBinding.js";
import { revokeAllRefreshTokens, isAccessTokenRevoked, isSessionRevoked } from "../lib/auth/tokenRevocation.js";
import { auditLog } from "../lib/auth/auditLog.js";
import { AccountBannedError, EmailNotVerifiedError, ForbiddenError, InvalidTokenError, SessionHijackError, TokenExpiredError, TokenRevokedError, UnauthorizedError } from "../errors/AppError.js";
import { setUserContext, addBreadcrumb, captureException } from "../lib/sentry.js";
import { CacheClient, CACHE_KEYS, CACHE_TTL } from "../lib/redis/cache.client.js";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    name?: string | null;
    tokenJti?: string;
    sessionId?: string;
  };
}

interface FocuraJwtPayload extends JwtPayload {
  sub: string;
  email: string;
  role: string;
  jti: string;
  version: number;
  type: string;
  sessionId?: string;
}

let publicKey: string;
try {
  if (process.env.JWT_PUBLIC_KEY) {
    publicKey = Buffer.from(process.env.JWT_PUBLIC_KEY, "base64").toString("utf-8");
  } else {
    // In production the keys live at `<repo>/keys`. The previous implementation
    // incorrectly looked one directory **above** the project root (`../keys`),
    // which caused a file‑not‑found error in CI and resulted in all protected
    // routes returning 401. Align the lookup with the rest of the codebase
    // (e.g., `src/lib/auth/backendToken.ts`) by using the correct relative path.
    const keysDir = path.join(process.cwd(), "keys");
    publicKey = fs.readFileSync(
      process.env.JWT_PUBLIC_KEY_PATH || path.join(keysDir, "public.pem"),
      "utf-8"
    );
  }
} catch (error) {
  throw new Error("JWT public key not found. Copy keys/public.pem from frontend.", { cause: error });
}

const CURRENT_TOKEN_VERSION = 1;

export const authenticate = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // 1. Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return next(new UnauthorizedError("Authentication required", "NO_TOKEN"));
    }
 
    const token = authHeader.slice(7).trim();
    if (!token) {
      return next(new UnauthorizedError("Authentication required", "NO_TOKEN"));
    }
 
    // 2. Verify JWT signature + standard claims
    let decoded: FocuraJwtPayload;
    try {
      decoded = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: "focura-app",
        audience: "focura-backend",
      }) as FocuraJwtPayload;
      
 
      if (process.env.NODE_ENV !== "production") {
        console.log("✅ Token verified:", { userId: decoded.sub, jti: decoded.jti?.slice(0, 8) });
      }
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        return next(new TokenExpiredError());
      }
      return next(new InvalidTokenError());
    }

    // 2.5. Check authentication result cache (performance optimization)
    if (decoded.jti) {
      const cacheKey = CACHE_KEYS.authResult(decoded.jti);
      const cachedResult = await CacheClient.get<{ userId: string; valid: boolean }>(cacheKey);
      
      if (cachedResult) {
    if (process.env.NODE_ENV !== "production") {
      console.log("✅ Auth result cache hit for token:", decoded.jti?.slice(0, 8));
    }
        // If cached result indicates invalid, return error immediately
        if (!cachedResult.valid) {
          return next(new InvalidTokenError("INVALID_TOKEN_CACHED"));
        }
        // If valid, continue to revocation check below
      }
    }
 
    // 3. Token version check
    if (decoded.version !== CURRENT_TOKEN_VERSION) {
      return next(new InvalidTokenError("TOKEN_VERSION_MISMATCH"));
    }
 
    // 4. Token type check
    if (decoded.type !== "access") {
      return next(new InvalidTokenError("INVALID_TOKEN_TYPE"));
    }
 
    // 5. Revocation check (Redis)
    if (decoded.jti) {
      const isRevoked = await isAccessTokenRevoked(decoded.jti);
      if (isRevoked) {
        return next(new TokenRevokedError());
      }
    }
 
    // 5.5. Session revocation check (max-sessions eviction tombstone)
    if (decoded.sessionId) {
      const sessionWasRevoked = await isSessionRevoked(decoded.sessionId);
      if (sessionWasRevoked) {
        return next(new TokenRevokedError());
      }
    }

    // 6. Session binding validation (Redis)
    if (decoded.sessionId) {
      const redis = getRedisClient();
      const metadataKey = `session:metadata:${decoded.sessionId}`;
      const storedMetadata = await redis.get(metadataKey);
 
      if (storedMetadata) {
                        const metadata: SessionMetadata = JSON.parse(storedMetadata);

        // The Next.js server legitimately calls this API with the user's
        // access token (SSR data hydration via lib/api/server.ts). Those
        // server-to-server requests carry no browser headers and can never be
        // device-bound — skip binding enforcement for them entirely, and never
        // let them claim the binding ahead of the real browser.
        // Trade-off: a stolen token used through a runtime-style client (curl,
        // undici, axios) also bypasses device binding — the real boundary stays
        // the RS256 tokens + HMAC exchange proof + revocation.
        if (!looksLikeServerToServerRequest(req)) {
          // A session minted by the server-to-server token exchange has no
          // browser binding (deviceId === null), or the stored binding was
          // created by a server process (runtime user-agent). Adopt the
          // fingerprint of the first real browser request instead of rejecting
          // it — otherwise every fresh session false-positives as a
          // DEVICE_MISMATCH and the user is logged out immediately after login.
          if (
            metadata.deviceId == null ||
            looksLikeServerToServerUA(metadata.userAgent)
          ) {
            // Trust boundary: the exchange happened server-to-server, so the
            // first real browser request claims the device binding. This keeps
            // legitimate logins working; the security boundary remains the
            // RS256 tokens + HMAC exchange proof, and all later requests are
            // bound.
            metadata.deviceId = generateDeviceFingerprint(req);
            metadata.ipAddress = getClientIp(req);
            metadata.userAgent = req.headers["user-agent"] || "unknown";
            metadata.lastActivity = Date.now();
            auditLog("SESSION_BOUND", {
              userId: decoded.sub,
              sessionId: decoded.sessionId,
              ip: metadata.ipAddress,
              userAgent: metadata.userAgent,
            });
          } else {
            const bindingValidation = validateSessionBinding(req, metadata);
            const currentIp = getClientIp(req);

            if (!bindingValidation.valid) {
              // Same IP + different device fingerprint is almost always a
              // legitimate device switch — DevTools mobile emulation, a
              // browser update, or moving between browsers on the same
              // machine — NOT a hijack. Re-bind the session to the current
              // device instead of revoking every token (which force-logs-out
              // the user mid-session). Only a device change from a DIFFERENT
              // public IP (a stolen token replayed from another network) is
              // treated as a hijack. Private/internal IPs (RFC1918, link-local)
              // carry no client identity behind the hosting proxy — the
              // server-side exchange and proxy hops surface 10.x addresses, so
              // a device change observed from one is also a re-bind.
              //
              // Security trade-off (deliberate): an attacker sharing the
              // victim's network (same NAT) could replay a stolen refresh
              // token and get a silent re-bind instead of a revocation. This
              // is accepted because the real boundary remains the RS256
              // tokens + HMAC exchange proof + rotation (device binding is a
              // soft secondary signal, and runtime-style clients already
              // bypass it). Every re-bind is recorded via the
              // SESSION_REBOUND audit event for review.
              const isSameIpDeviceChange =
                bindingValidation.reason === "DEVICE_MISMATCH" &&
                (currentIp === metadata.ipAddress ||
                  isPrivateIp(currentIp) ||
                  isPrivateIp(metadata.ipAddress));

              if (isSameIpDeviceChange) {
                metadata.deviceId = generateDeviceFingerprint(req);
                metadata.userAgent = req.headers["user-agent"] || "unknown";
                auditLog("SESSION_REBOUND", {
                  userId: decoded.sub,
                  sessionId: decoded.sessionId,
                  ip: currentIp,
                  userAgent: metadata.userAgent,
                });
              } else {
                // Genuine hijack — revoke all tokens, drop the cached auth
                // result, and log the suspicious activity before erroring.
                await revokeAllRefreshTokens(decoded.sub);
                if (decoded.jti) {
                  await CacheClient.delete(CACHE_KEYS.authResult(decoded.jti));
                }
                auditLog("SESSION_HIJACK_DETECTED", {
                  userId: decoded.sub,
                  sessionId: decoded.sessionId,
                  reason: bindingValidation.reason,
                  ip: currentIp,
                  userAgent: req.headers["user-agent"],
                });
                return next(new SessionHijackError(bindingValidation.reason));
              }
            }
          }

          // Bump lastActivity
          metadata.lastActivity = Date.now();
          await redis.setex(metadataKey, 7 * 24 * 60 * 60, JSON.stringify(metadata));
        }
      }
    }
 
    // 7. DB user lookup with caching
    const userProfileKey = CACHE_KEYS.userProfile(decoded.sub);
    const cachedUser = await CacheClient.get<{
      id: string;
      email: string;
      name: string | null;
      role: string;
      emailVerified: Date | null;
      bannedAt: Date | null;
      banReason: string | null;
    }>(userProfileKey);

    let user;
    
    if (cachedUser) {
      if (process.env.NODE_ENV !== "production") {
        console.log("✅ User profile cache hit for:", decoded.sub);
      }
      user = cachedUser;
    } else {
      if (process.env.NODE_ENV !== "production") {
        console.log("❌ User profile cache miss for:", decoded.sub);
      }
      user = await prisma.user.findUnique({
        where: { id: decoded.sub },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          emailVerified: true,
          bannedAt: true,
          banReason: true,
        },
      });

      if (user) {
        // Cache the user profile for future requests
        await CacheClient.set(userProfileKey, user, CACHE_TTL.USER_PROFILE);
      }
    }

    if (!user) {
      return next(new UnauthorizedError("User not found", "USER_NOT_FOUND"));
    }

    if (!user.emailVerified) {
      return next(new EmailNotVerifiedError());
    }

    if (user.bannedAt) {
      return next(new AccountBannedError(user.banReason, user.bannedAt));
    }

    // 7.5. Cache successful authentication result
    if (decoded.jti) {
      const authResultKey = CACHE_KEYS.authResult(decoded.jti);
      await CacheClient.set(authResultKey, { userId: decoded.sub, valid: true }, CACHE_TTL.AUTH_RESULT);
    }
 
    // 8. Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tokenJti: decoded.jti,
      sessionId: decoded.sessionId,
    };

    // Set user context in Sentry for better error tracking
    setUserContext({
      id: user.id,
      email: user.email,
      username: user.name || undefined,
    });

    // Add breadcrumb for authentication success
    addBreadcrumb({
      category: "auth",
      message: "User authenticated successfully",
      level: "info",
      data: {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
    });

    next();
  } catch (err) {
    console.error("🔴  Unexpected authentication error:", err);
    
    // Capture authentication errors in Sentry
    if (err instanceof Error) {
      captureException(err, {
        context: "authentication",
        userId: req.user?.id,
      });
    }
    
    next(err); // Let errorHandler deal with truly unexpected errors
  }
};
 
// ─── authorize ────────────────────────────────────────────────────────────────
 
export const authorize = (...roles: string[]) =>
  (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError("Authentication required", "NOT_AUTHENTICATED"));
    }
    if (!roles.includes(req.user.role)) {
      return next(new ForbiddenError("Insufficient permissions"));
    }
    next();
  };// ─── rateLimitByUser ──────────────────────────────────────────────────────────
// Per-user API rate limiting moved to src/middleware/apiRateLimiter.ts
// (rateLimitByUser + rateLimitUserApi for the core CRUD routes).