import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { getRedisClient } from "../redis/redis.client.js";

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
const CSRF_TOKEN_TTL = 3600;

declare global {
  var _testCsrfTokens: Map<string, string> | undefined;
}

export async function generateCsrfToken(userId: string, sessionId: string): Promise<string> {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("base64url");
  const key = `csrf:${userId}:${sessionId}`;

  try {
    await getRedisClient().setex(key, CSRF_TOKEN_TTL, token);
  } catch (error) {
    console.error("Failed to store CSRF token in Redis:", error);
    // In test environments, store in-memory fallback
    if (!global._testCsrfTokens) global._testCsrfTokens = new Map();
    global._testCsrfTokens.set(key, token);
    setTimeout(() => global._testCsrfTokens?.delete(key), CSRF_TOKEN_TTL * 1000);
  }

  return token;
}

export async function validateCsrfToken(
  userId: string,
  sessionId: string,
  token: string,
): Promise<boolean> {
  if (!token || token.length === 0) return false;

  const key = `csrf:${userId}:${sessionId}`;

  try {
    const storedToken = await getRedisClient().get(key);
    if (!storedToken) return false;

    return crypto.timingSafeEqual(
      Buffer.from(token, "base64url"),
      Buffer.from(storedToken, "base64url"),
    );
  } catch (error) {
    console.error("Failed to validate CSRF token from Redis:", error);

    // Test environment: fall back to in-memory tokens
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

    // Fail closed: reject if Redis is unavailable
    return false;
  }
}

export const requireCsrfToken = () => {
  return async (req: CsrfRequest, res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();

    if (req.path.includes("/webhooks/") || req.path.includes("/webhook")) {
      return next();
    }

    // Integration OAuth callback is protected by its own CSRF token in the state parameter
    if (req.path.includes("/callback")) {
      return next();
    }

    // GitHub/Slack link endpoints are safe (only updates task metadata)
    if (req.path.includes("/github-link") || req.path.includes("/slack-link") || req.path.includes("/slack-unlink")) {
      return next();
    }

    const csrfToken = req.headers["x-csrf-token"] as string;
    const user = req.user;

    if (!user?.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "NOT_AUTHENTICATED",
      });
    }

    const sessionId = user.sessionId || "default";

    // Test environment with in-memory tokens
    if (process.env.ENFORCE_CSRF_IN_TESTS === "true") {
      const isValid = await validateCsrfToken(user.id, sessionId, csrfToken);
      if (!isValid) {
        return res.status(403).json({
          success: false,
          message: "Invalid or missing CSRF token",
          code: "CSRF_VALIDATION_FAILED",
        });
      }
      return next();
    }

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

export const getCsrfTokenHandler = async (req: CsrfRequest, res: Response) => {
  if (!req.user?.id) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
      code: "NOT_AUTHENTICATED",
    });
  }

  const sessionId = req.user.sessionId || "default";

  try {
    const token = await generateCsrfToken(req.user.id, sessionId);
    res.json({
      success: true,
      data: { csrfToken: token, expiresIn: CSRF_TOKEN_TTL },
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