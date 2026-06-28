import { Request, Response, NextFunction } from "express";
import jwt, {JwtPayload} from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma.js";
import { getRedisClient } from "../redis/redis.client.js";
import { getClientIp, SessionMetadata, validateSessionBinding } from "../lib/auth/sessionBinding.js";
import { revokeAllRefreshTokens, isAccessTokenRevoked } from "../lib/auth/tokenRevocation.js";
import { auditLog } from "../lib/auth/auditLog.js";
import { AccountBannedError, EmailNotVerifiedError, ForbiddenError, InvalidTokenError, SessionHijackError, TokenExpiredError, TokenRevokedError, UnauthorizedError } from "../errors/AppError.js";
import { setUserContext, addBreadcrumb, captureException } from "../lib/sentry.js";

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
    const keysDir = path.join(process.cwd(), "..", "keys");
    publicKey = fs.readFileSync(
      process.env.JWT_PUBLIC_KEY_PATH || path.join(keysDir, "public.pem"),
      "utf-8"
    );
  }
} catch (error) {
  console.error("❌  Failed to load JWT public key:", error);
  throw new Error("JWT public key not found. Copy keys/public.pem from frontend.");
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
 
      console.log("✅ Token verified:", { userId: decoded.sub, jti: decoded.jti?.slice(0, 8) });
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        return next(new TokenExpiredError());
      }
      return next(new InvalidTokenError());
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
 
    // 6. Session binding validation (Redis)
    if (decoded.sessionId) {
      const redis = getRedisClient();
      const metadataKey = `session:metadata:${decoded.sessionId}`;
      const storedMetadata = await redis.get(metadataKey);
 
      if (storedMetadata) {
        const metadata: SessionMetadata = JSON.parse(storedMetadata);
        const bindingValidation = validateSessionBinding(req, metadata);
 
        if (!bindingValidation.valid) {
          // Revoke all tokens and log the suspicious activity before erroring
          await revokeAllRefreshTokens(decoded.sub);
          auditLog("SESSION_HIJACK_DETECTED", {
            userId: decoded.sub,
            sessionId: decoded.sessionId,
            reason: bindingValidation.reason,
            ip: getClientIp(req),
            userAgent: req.headers["user-agent"],
          });
          return next(new SessionHijackError(bindingValidation.reason));
        }
 
        // Bump lastActivity
        metadata.lastActivity = Date.now();
        await redis.setex(metadataKey, 7 * 24 * 60 * 60, JSON.stringify(metadata));
      }
    }
 
    // 7. DB user lookup
    const user = await prisma.user.findUnique({
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
 
    if (!user) {
      return next(new UnauthorizedError("User not found", "USER_NOT_FOUND"));
    }
 
    if (!user.emailVerified) {
      return next(new EmailNotVerifiedError());
    }
 
    if (user.bannedAt) {
      return next(new AccountBannedError(user.banReason, user.bannedAt));
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
  };
 
// ─── rateLimitByUser ──────────────────────────────────────────────────────────
 


export const rateLimitByUser = (tier?: "free" | "pro" | "enterprise") => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id) return next();

    try {
      const { limitApiRequest } = await import("../lib/limiter.js");
      const result = await limitApiRequest(req.user.id, tier || "free");

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
      next();
    }
  };
};