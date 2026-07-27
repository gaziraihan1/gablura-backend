/**
 * src/modules/apikey/apikey.middleware.ts
 *
 * Middleware for validating API tokens.
 * Supports both JWT (existing) and API token authentication.
 */

import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import { validateApiKey } from "./apikey.model.js";
import { UnauthorizedError } from "../../errors/index.js";

// ─── API Token Authentication ────────────────────────────────────────────────

/**
 * Authenticate using API token from Authorization header.
 * Format: Authorization: Bearer <api-token>
 */
export async function authenticateWithApiKey(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new UnauthorizedError("Missing or invalid authorization header"));
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  // Check if this looks like an API token (starts with "foc_")
  if (!token.startsWith("foc_")) {
    return next(new UnauthorizedError("Invalid token format"));
  }

  try {
    const result = await validateApiKey(token);

    if (!result) {
      return next(new UnauthorizedError("Invalid or expired API token"));
    }

    // Set userId on request
    req.user!.id = result.userId;

    next();
  } catch {
    return next(new UnauthorizedError("API token validation failed"));
  }
}

/**
 * Check if the request is using API token authentication.
 */
export function isApiKeyAuth(req: AuthRequest): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return false;
  }
  const token = authHeader.substring(7);
  return token.startsWith("foc_");
}
