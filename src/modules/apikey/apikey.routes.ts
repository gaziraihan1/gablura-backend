/**
 * src/modules/apikey/apikey.routes.ts
 *
 * API key routes - defines endpoints for API key management.
 */

import { Router } from "express";
import { authenticate } from "../../middleware/auth.js";
import * as ApiKeyController from "./apikey.controller.js";
import { asyncHandler } from "../../errors/asyncHandler.js";

const router = Router();

// ─── All routes require authentication ───────────────────────────────────────

router.use(authenticate);

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/api-keys
 * Get all API keys for the authenticated user
 */
router.get("/", asyncHandler(ApiKeyController.getApiKeys));

/**
 * POST /api/v1/api-keys
 * Create a new API key
 * Body: { name: string, expiresInDays?: number }
 */
router.post("/", asyncHandler(ApiKeyController.createApiKey));

/**
 * PATCH /api/v1/api-keys/:id/toggle
 * Toggle API key active status
 */
router.patch("/:id/toggle", asyncHandler(ApiKeyController.toggleApiKey));

/**
 * DELETE /api/v1/api-keys/:id
 * Delete an API key
 */
router.delete("/:id", asyncHandler(ApiKeyController.deleteApiKey));

export default router;
