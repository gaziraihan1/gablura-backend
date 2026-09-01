import type { Request, Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { RatingQuery } from './rating.query.js';
import { RatingMutation } from './rating.mutation.js';
import {
  createRatingSchema,
  updateRatingSchema,
} from './rating.validators.js';
import { asyncHandler, ValidationError } from '../../errors/index.js';

/**
 * GET /api/v1/ratings
 * Public — list all ratings with stats. No auth required.
 */
export const getRatings = asyncHandler(async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));

  const result = await RatingQuery.getRatings(page, pageSize);
  res.json({ success: true, data: result.ratings, pagination: result.pagination, stats: result.stats });
});

/**
 * GET /api/v1/ratings/mine
 * Authenticated — get the current user's rating.
 */
export const getMyRating = asyncHandler(async (req: AuthRequest, res: Response) => {
  const rating = await RatingQuery.getUserRating(req.user!.id);
  res.json({ success: true, data: rating });
});

/**
 * POST /api/v1/ratings
 * Authenticated — create a rating.
 */
export const createRating = asyncHandler(async (req: AuthRequest, res: Response) => {
  const parsed = createRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.issues);
  }

  const rating = await RatingMutation.createRating({
    userId: req.user!.id,
    ...parsed.data,
  });

  res.status(201).json({ success: true, data: rating });
});

/**
 * PUT /api/v1/ratings/:ratingId
 * Authenticated — update own rating.
 */
export const updateRating = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ratingId } = req.params;
  const parsed = updateRatingSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Validation error', parsed.error.issues);
  }

  const rating = await RatingMutation.updateRating(
    ratingId,
    req.user!.id,
    parsed.data,
  );

  res.json({ success: true, data: rating });
});

/**
 * DELETE /api/v1/ratings/:ratingId
 * Authenticated — delete own rating.
 */
export const deleteRating = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ratingId } = req.params;
  await RatingMutation.deleteRating(ratingId, req.user!.id);
  res.json({ success: true, message: 'Rating deleted successfully' });
});
