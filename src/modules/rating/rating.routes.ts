import { Router } from 'express';
import {
  getRatings,
  getMyRating,
  createRating,
  updateRating,
  deleteRating,
} from './rating.controller.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();

// ─── Public routes ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/ratings
 * List all ratings with aggregate stats. No auth required.
 */
router.get('/', getRatings);

// ─── Authenticated routes ───────────────────────────────────────────────────

/**
 * GET /api/v1/ratings/mine
 * Get the current user's own rating.
 */
router.get('/mine', authenticate, getMyRating);

/**
 * POST /api/v1/ratings
 * Create a new rating (one per user).
 */
router.post('/', authenticate, createRating);

/**
 * PUT /api/v1/ratings/:ratingId
 * Update own rating.
 */
router.put('/:ratingId', authenticate, updateRating);

/**
 * DELETE /api/v1/ratings/:ratingId
 * Delete own rating.
 */
router.delete('/:ratingId', authenticate, deleteRating);

export default router;
