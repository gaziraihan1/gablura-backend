/**
 * src/modules/apikey/apikey.model.ts
 *
 * Database operations for API keys.
 */

import { prisma } from "../../lib/prisma.js";
import { generateApiToken, hashToken, verifyToken } from "./apikey.utils.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiKeyResponse {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateApiKeyResult {
  apiKey: ApiKeyResponse;
  rawToken: string; // Only shown once to the user
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new API key for a user.
 * Returns the API key info and the raw token (shown once).
 */
export async function createApiKey(
  userId: string,
  name: string,
  expiresInDays?: number
): Promise<CreateApiKeyResult> {
  const { rawToken, prefix } = generateApiToken();
  const hash = await hashToken(rawToken);

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      prefix,
      hash,
      userId,
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      isActive: true,
      createdAt: true,
    },
  });

  return { apiKey, rawToken };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Get all API keys for a user.
 */
export async function getApiKeysByUser(userId: string): Promise<ApiKeyResponse[]> {
  return prisma.apiKey.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      isActive: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Get an API key by ID (for the owning user).
 */
export async function getApiKeyById(
  apiKeyId: string,
  userId: string
): Promise<ApiKeyResponse | null> {
  return prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      isActive: true,
      createdAt: true,
    },
  });
}

/**
 * Find and validate an API key by token.
 * Returns the user ID if valid, null otherwise.
 */
export async function validateApiKey(token: string): Promise<{ userId: string } | null> {
  const prefix = token.substring(0, 12); // "foc_" + 8 chars

  // Find potential matches by prefix
  const potentialKeys = await prisma.apiKey.findMany({
    where: {
      prefix,
      isActive: true,
    },
    select: {
      id: true,
      hash: true,
      userId: true,
      expiresAt: true,
    },
  });

  for (const key of potentialKeys) {
    // Check expiration
    if (key.expiresAt && key.expiresAt < new Date()) {
      continue;
    }

    // Verify token against hash
    const isValid = await verifyToken(token, key.hash);
    if (isValid) {
      // Update lastUsedAt
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      });

      return { userId: key.userId };
    }
  }

  return null;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Toggle API key active status.
 */
export async function toggleApiKey(
  apiKeyId: string,
  userId: string
): Promise<ApiKeyResponse | null> {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, userId },
    select: { id: true, isActive: true },
  });

  if (!apiKey) return null;

  return prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: !apiKey.isActive },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      isActive: true,
      createdAt: true,
    },
  });
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete an API key.
 */
export async function deleteApiKey(
  apiKeyId: string,
  userId: string
): Promise<boolean> {
  const result = await prisma.apiKey.deleteMany({
    where: { id: apiKeyId, userId },
  });

  return result.count > 0;
}
