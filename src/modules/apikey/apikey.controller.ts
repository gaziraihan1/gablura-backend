/**
 * src/modules/apikey/apikey.controller.ts
 *
 * API key controller - handles HTTP requests for API key operations.
 */

import type { Response } from "express";
import type { AuthRequest } from "../../middleware/auth.js";
import * as ApiKeyModel from "./apikey.model.js";
import { BadRequestError, NotFoundError, UnauthorizedError } from "../../errors/index.js";

// ─── Helper to get userId from request ───────────────────────────────────────

function getUserId(req: AuthRequest): string {
  if (!req.user?.id) {
    throw new UnauthorizedError("User not authenticated");
  }
  return req.user.id;
}

// ─── Get all API keys ────────────────────────────────────────────────────────

export async function getApiKeys(req: AuthRequest, res: Response) {
  const userId = getUserId(req);

  const apiKeys = await ApiKeyModel.getApiKeysByUser(userId);

  return res.json({
    success: true,
    data: apiKeys,
  });
}

// ─── Create API key ──────────────────────────────────────────────────────────

export async function createApiKey(req: AuthRequest, res: Response) {
  const userId = getUserId(req);
  const { name, expiresInDays } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new BadRequestError("API key name is required");
  }

  if (name.length > 50) {
    throw new BadRequestError("API key name must be 50 characters or less");
  }

  if (expiresInDays !== undefined && (typeof expiresInDays !== "number" || expiresInDays < 1)) {
    throw new BadRequestError("Expiration must be a positive number of days");
  }

  // Check for existing active keys with same name
  const existingKeys = await ApiKeyModel.getApiKeysByUser(userId);
  const duplicateName = existingKeys.find(
    (k) => k.name.toLowerCase() === name.trim().toLowerCase() && k.isActive
  );
  if (duplicateName) {
    throw new BadRequestError("An active API key with this name already exists");
  }

  const { apiKey, rawToken } = await ApiKeyModel.createApiKey(
    userId,
    name.trim(),
    expiresInDays
  );

  return res.status(201).json({
    success: true,
    data: {
      ...apiKey,
      token: rawToken, // Only returned on creation
    },
    message: "API key created successfully. Save the token - it won't be shown again.",
  });
}

// ─── Toggle API key ──────────────────────────────────────────────────────────

export async function toggleApiKey(req: AuthRequest, res: Response) {
  const userId = getUserId(req);
  const { id } = req.params;

  const apiKey = await ApiKeyModel.toggleApiKey(id, userId);

  if (!apiKey) {
    throw new NotFoundError("API key not found");
  }

  return res.json({
    success: true,
    data: apiKey,
    message: `API key ${apiKey.isActive ? "activated" : "deactivated"}`,
  });
}

// ─── Delete API key ──────────────────────────────────────────────────────────

export async function deleteApiKey(req: AuthRequest, res: Response) {
  const userId = getUserId(req);
  const { id } = req.params;

  const deleted = await ApiKeyModel.deleteApiKey(id, userId);

  if (!deleted) {
    throw new NotFoundError("API key not found");
  }

  return res.json({
    success: true,
    message: "API key deleted successfully",
  });
}
