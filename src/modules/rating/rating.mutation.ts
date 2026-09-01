import { prisma } from '../../lib/prisma.js';
import type { CreateRatingInput, UpdateRatingInput } from './rating.types.js';
import { ratingFullInclude } from './rating.selects.js';
import { NotFoundError, ConflictError } from '../../errors/index.js';

export const RatingMutation = {
  /**
   * Create a new rating. One rating per user enforced by unique constraint.
   */
  async createRating(input: CreateRatingInput) {
    // Check if user already has a rating
    const existing = await prisma.rating.findUnique({
      where: { userId: input.userId },
    });

    if (existing) {
      throw new ConflictError(
        'You have already rated this application. Please update your existing rating.',
        'RATING_EXISTS',
      );
    }

    return prisma.rating.create({
      data: {
        userId: input.userId,
        stars: input.stars,
        comment: input.comment ?? null,
      },
      include: ratingFullInclude,
    });
  },

  /**
   * Update an existing rating. Only the owner can update.
   */
  async updateRating(
    ratingId: string,
    userId: string,
    input: UpdateRatingInput,
  ) {
    const existing = await prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!existing) {
      throw new NotFoundError('Rating');
    }

    if (existing.userId !== userId) {
      throw new NotFoundError('Rating');
    }

    return prisma.rating.update({
      where: { id: ratingId },
      data: {
        ...(input.stars !== undefined && { stars: input.stars }),
        ...(input.comment !== undefined && { comment: input.comment }),
        edited: true,
      },
      include: ratingFullInclude,
    });
  },

  /**
   * Delete a rating. Only the owner can delete.
   */
  async deleteRating(ratingId: string, userId: string): Promise<void> {
    const existing = await prisma.rating.findUnique({
      where: { id: ratingId },
    });

    if (!existing) {
      throw new NotFoundError('Rating');
    }

    if (existing.userId !== userId) {
      throw new NotFoundError('Rating');
    }

    await prisma.rating.delete({ where: { id: ratingId } });
  },
};
