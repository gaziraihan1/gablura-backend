import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { prisma } from "../lib/prisma.js";
import { redis } from "../lib/redis.js";
import { getClientIp, SessionMetadata, validateSessionBinding } from "../lib/auth/sessionBinding.js";
import { revokeAllRefreshTokens } from "../lib/auth/tokenRevocation.js";
import { auditLog } from "../lib/auth/auditLog.js";

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
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      console.log("❌ Auth middleware: NO_TOKEN");
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "NO_TOKEN",
      });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      console.log("❌ Auth middleware: Empty token");
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "NO_TOKEN",
      });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        issuer: "focura-app",
        audience: "focura-backend",
      });
      console.log("✅ Token verified:", { userId: decoded.sub, jti: decoded.jti?.slice(0, 8) });
    } catch (err: any) {
      if (err.name === "TokenExpiredError") {
        console.log("⏰ Token expired:", { error: err.message });
        return res.status(401).json({
          success: false,
          message: "Token expired. Please refresh your session.",
          code: "TOKEN_EXPIRED",
        });
      }
      console.log("❌ Token verification failed:", err.message);
      return res.status(401).json({
        success: false,
        message: "Invalid token",
        code: "INVALID_TOKEN",
      });
    }

    // Version check
    if (decoded.version !== CURRENT_TOKEN_VERSION) {
      console.log("❌ Token version mismatch:", { expected: CURRENT_TOKEN_VERSION, got: decoded.version });
      return res.status(401).json({
        success: false,
        message: "Token version mismatch. Please log in again.",
        code: "TOKEN_VERSION_MISMATCH",
      });
    }

    // Type check
    if (decoded.type !== "access") {
      console.log("❌ Invalid token type:", { expected: "access", got: decoded.type });
      return res.status(401).json({
        success: false,
        message: "Invalid token type",
        code: "INVALID_TOKEN_TYPE",
      });
    }

    

    // CRITICAL: Check if token was revoked (logout or refresh rotation)
    if (decoded.jti && process.env.UPSTASH_REDIS_REST_URL) {
      const { isAccessTokenRevoked } = await import("../lib/auth/tokenRevocation.js");
      const isRevoked = await isAccessTokenRevoked(decoded.jti);
      if (isRevoked) {
        console.log("❌ Token revoked:", { jti: decoded.jti.slice(0, 8) });
        return res.status(401).json({
          success: false,
          message: "Token has been revoked",
          code: "TOKEN_REVOKED",
        });
      }
    }

    if (decoded.sessionId && redis) {
      const metadataKey = `session:metadata:${decoded.sessionId}`;
      const storedMetadata = await redis.get<string>(metadataKey);

      if (storedMetadata) {
        const metadata: SessionMetadata = JSON.parse(storedMetadata);
        const bindingValidation = validateSessionBinding(req, metadata);

        if (!bindingValidation.valid) {
          await revokeAllRefreshTokens(decoded.sub);

          auditLog('SESSION_HIJACK_DETECTED', {
            userId: decoded.sub,
            sessionId: decoded.sessionId,
            reason: bindingValidation.reason,
            ip: getClientIp(req),
            userAgent: req.headers['user-agent'],
          });

          return res.status(401).json({
            success: false,
            message: 'Session validation failed. Please login again.',
            code: 'SESSION_HIJACK_DETECTED',
            reason: bindingValidation.reason,
          });
        }

        metadata.lastActivity = Date.now();
        await redis.setex(metadataKey, 7 * 24 * 60 * 60, JSON.stringify(metadata));
      }
    }
    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { 
        id: true, 
        email: true, 
        name: true, 
        role: true, 
        emailVerified: true, 
        bannedAt: true, 
        banReason: true 
      },
    });

    if (!user) {
      console.log("❌ User not found:", { userId: decoded.sub });
      return res.status(401).json({
        success: false,
        message: "User not found",
        code: "USER_NOT_FOUND",
      });
    }

    if (!user.emailVerified) {
      console.log("❌ Email not verified:", { userId: user.id });
      return res.status(403).json({
        success: false,
        message: "Please verify your email address",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    if (user.bannedAt) {
      console.log("❌ Account banned:", { userId: user.id, bannedAt: user.bannedAt });
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
        reason: user.banReason ?? undefined,
        bannedAt: user.bannedAt,
        code: "ACCOUNT_BANNED"
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tokenJti: decoded.jti,
      sessionId: decoded.sessionId,
    };

    next();
  } catch (err) {
    console.error("🔴  Authentication error:", err);
    return res.status(401).json({
      success: false,
      message: "Authentication failed",
      code: "AUTH_ERROR",
      ...(process.env.NODE_ENV === "development" && { error: (err as Error).message }),
    });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "NOT_AUTHENTICATED",
      });
    }

    if (!roles.includes(req.user.role)) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `⚠️  Access denied. Required: [${roles.join(", ")}], User has: ${req.user.role}`
        );
      }
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
        code: "FORBIDDEN",
      });
    }

    next();
  };
};

export const rateLimitByUser = (tier?: "free" | "pro" | "enterprise") => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id || !process.env.UPSTASH_REDIS_REST_URL) {
      return next();
    }

    try {
      const { limitApiRequest } = await import("../lib/limiter.js");
      const result = await limitApiRequest(req.user.id, tier || "free");

      res.setHeader("X-RateLimit-Limit", result.limit ?? 60);
      res.setHeader("X-RateLimit-Remaining", result.remaining ?? 0);
      if (result.reset) res.setHeader("X-RateLimit-Reset", result.reset.toString());

      if (!result.success) {
        const retryAfter = result.reset
          ? Math.ceil((result.reset - Date.now()) / 1000)
          : 60;

        return res.status(429).json({
          success: false,
          message: "Rate limit exceeded. Please try again later.",
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter,
        });
      }

      next();
    } catch (err) {
      console.error("Rate limit error:", err);
      next();
    }
  };
};