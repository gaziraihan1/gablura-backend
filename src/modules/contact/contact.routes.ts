import { Router } from "express";
import { contactRateLimit } from "./contact.rateLimit.js";
import {
  submitContactMessage,
  listContactMessages,
} from "./contact.controller.js";
import { authenticate } from "../../middleware/auth.js";
import { requireGabluraAdmin } from "../../middleware/focuraAdmin.js";
const router = Router();

// ─── Public routes ────────────────────────────────────────────────────────────

/**
 * POST /api/v1/contact
 * Submit a contact form message.
 * Public — no auth required.
 * Rate-limited: 3 requests / IP / hour + 2 requests / email / 24 h
 */
router.post(
  "/",
  contactRateLimit,
  submitContactMessage
);

// ─── Admin-only routes ────────────────────────────────────────────────────────

/**
 * GET /api/v1/contact
 * List contact messages with filtering and pagination.
 * Requires ADMIN or SUPER_ADMIN role.
 */
router.get(
  "/",
  authenticate,
  requireGabluraAdmin,
  listContactMessages
);
export default router;