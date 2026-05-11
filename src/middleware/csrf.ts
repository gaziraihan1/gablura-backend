import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { redis } from "../lib/redis.js";

interface CsrfRequest extends Request {
  csrfToken?: string;
  user?: {
    id: string;
    email: string;
    role: string;
    tokenJti?: string;
    sessionId?: string;
  };
}

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_TTL = 3600; // 1 hour

// Declare global type for TypeScript (shared with test helpers)
declare global {
  var _testCsrfTokens: Map<string, string> | undefined;
}

/**
 * Generate a cryptographically secure CSRF token for the user session
 */
export async function generateCsrfToken(
  userId: string,
  sessionId: string,
): Promise<string> {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("base64url");
  const key = `csrf:${userId}:${sessionId}`;

  if (redis && process.env.UPSTASH_REDIS_REST_URL) {
    try {
      await redis.setex(key, CSRF_TOKEN_TTL, token);
    } catch (error) {
      console.error("Failed to store CSRF token in Redis:", error);
    }
  }

  return token;
}

/**
 * Validate CSRF token for state-changing operations
 */
export async function validateCsrfToken(
  userId: string,
  sessionId: string,
  token: string,
): Promise<boolean> {
  if (!token || token.length === 0) return false;

  const key = `csrf:${userId}:${sessionId}`;

  // Redis path (production)
  if (redis && process.env.UPSTASH_REDIS_REST_URL) {
    try {
      const storedToken = await redis.get<string>(key);
      if (!storedToken) return false;

      try {
        return crypto.timingSafeEqual(
          Buffer.from(token, "base64url"),
          Buffer.from(storedToken, "base64url"),
        );
      } catch {
        return false;
      }
    } catch (error) {
      console.error("Failed to validate CSRF token from Redis:", error);
      if (process.env.NODE_ENV === "development") {
        console.warn("⚠️  CSRF validation skipped (Redis unavailable in development)");
        return true;
      }
      return false;
    }
  }

  // No Redis: test environment with ENFORCE_CSRF_IN_TESTS
  // Reads from global._testCsrfTokens populated by generateTestCsrfToken()
  if (process.env.ENFORCE_CSRF_IN_TESTS === "true") {
    const storedToken = global._testCsrfTokens?.get(key);
    if (!storedToken) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token, "base64url"),
        Buffer.from(storedToken, "base64url"),
      );
    } catch {
      return false;
    }
  }

  // No Redis, not a test: skip in dev, block in prod
  if (process.env.NODE_ENV === "development") {
    console.warn("⚠️  CSRF validation skipped (Redis not configured)");
    return true;
  }

  return false;
}

/**
 * Middleware to require CSRF token on state-changing operations
 */
export const requireCsrfToken = () => {
  return async (req: CsrfRequest, res: Response, next: NextFunction) => {
    // Only apply to state-changing methods
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // Skip CSRF for webhook endpoints (they use signature validation)
    if (req.path.includes("/webhooks/") || req.path.includes("/webhook")) {
      return next();
    }

    const csrfToken = req.headers["x-csrf-token"] as string;
    const user = req.user;

    if (!user || !user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "NOT_AUTHENTICATED",
      });
    }

    const sessionId = user.sessionId || "default";

    // No Redis configured
    if (!redis || !process.env.UPSTASH_REDIS_REST_URL) {
      // Test environment: run real validation against global._testCsrfTokens
      if (process.env.ENFORCE_CSRF_IN_TESTS === "true") {
        const isValid = await validateCsrfToken(user.id, sessionId, csrfToken);
        if (!isValid) {
          console.warn("⚠️ CSRF token validation failed (test):", {
            userId: user.id,
            method: req.method,
            path: req.path,
            hasToken: !!csrfToken,
          });
          return res.status(403).json({
            success: false,
            message: "Invalid or missing CSRF token",
            code: "CSRF_VALIDATION_FAILED",
          });
        }
        return next();
      }

      // Development without Redis: bypass
      if (process.env.NODE_ENV === "development") {
        console.warn("⚠️  CSRF protection disabled (Redis not configured)");
        return next();
      }

      // Production without Redis: hard block
      return res.status(503).json({
        success: false,
        message: "CSRF protection unavailable",
        code: "CSRF_SERVICE_UNAVAILABLE",
      });
    }

    // Redis available: normal production validation path
    const isValid = await validateCsrfToken(user.id, sessionId, csrfToken);

    if (!isValid) {
      console.warn("⚠️ CSRF token validation failed:", {
        userId: user.id,
        method: req.method,
        path: req.path,
        ip: req.ip,
        hasToken: !!csrfToken,
      });

      return res.status(403).json({
        success: false,
        message: "Invalid or missing CSRF token",
        code: "CSRF_VALIDATION_FAILED",
      });
    }

    next();
  };
};

/**
 * Endpoint to get a CSRF token (called after authentication)
 * CRITICAL: This endpoint must NOT have CSRF protection (chicken-and-egg problem)
 */
export const getCsrfTokenHandler = async (req: CsrfRequest, res: Response) => {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      code: "NOT_AUTHENTICATED",
    });
  }

  const sessionId = req.user.sessionId || "default";

  if (!redis || !process.env.UPSTASH_REDIS_REST_URL) {
    if (process.env.NODE_ENV === "development") {
      return res.json({
        success: true,
        data: {
          csrfToken: "dev-csrf-token",
          expiresIn: CSRF_TOKEN_TTL,
          warning: "CSRF protection disabled in development mode",
        },
      });
    }

    return res.status(503).json({
      success: false,
      message: "CSRF service unavailable",
      code: "CSRF_SERVICE_UNAVAILABLE",
    });
  }

  try {
    const token = await generateCsrfToken(req.user.id, sessionId);

    res.json({
      success: true,
      data: {
        csrfToken: token,
        expiresIn: CSRF_TOKEN_TTL,
      },
    });
  } catch (error) {
    console.error("Error generating CSRF token:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate CSRF token",
      code: "CSRF_GENERATION_FAILED",
    });
  }
};