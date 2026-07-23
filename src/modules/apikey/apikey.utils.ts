/**
 * src/modules/apikey/apikey.utils.ts
 *
 * Utility functions for API key generation and hashing.
 */

import argon2 from "argon2";
import crypto from "crypto";

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_PREFIX = "foc_";
const TOKEN_LENGTH = 32;
const PREFIX_DISPLAY_LENGTH = 8;

// ─── Token Generation ────────────────────────────────────────────────────────

/**
 * Generate a new API token.
 * Returns the raw token (to show to user once) and the prefix (for display).
 */
export function generateApiToken(): { rawToken: string; prefix: string } {
  const randomBytes = crypto.randomBytes(TOKEN_LENGTH);
  const rawToken = TOKEN_PREFIX + randomBytes.toString("base64url");
  const prefix = rawToken.substring(0, TOKEN_PREFIX.length + PREFIX_DISPLAY_LENGTH);

  return { rawToken, prefix };
}

// ─── Token Hashing ───────────────────────────────────────────────────────────

/**
 * Hash an API token using Argon2.
 */
export async function hashToken(token: string): Promise<string> {
  return argon2.hash(token, {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Verify a token against its hash.
 */
export async function verifyToken(token: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, token);
  } catch {
    return false;
  }
}

// ─── Token Validation ────────────────────────────────────────────────────────

/**
 * Validate token format.
 */
export function isValidTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && token.length > TOKEN_PREFIX.length;
}

/**
 * Extract prefix from token.
 */
export function extractPrefix(token: string): string {
  return token.substring(0, TOKEN_PREFIX.length + PREFIX_DISPLAY_LENGTH);
}
