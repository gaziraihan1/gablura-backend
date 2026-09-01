// src/tests/unit/rating/rating.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for:
//   • rating.query     — getRatings, getRatingById, getUserRating
//   • rating.mutation  — createRating, updateRating, deleteRating
//   • rating.validator — createRatingSchema, updateRatingSchema
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    rating: {
      findMany:  vi.fn(),
      findUnique: vi.fn(),
      count:     vi.fn(),
      aggregate: vi.fn(),
      groupBy:   vi.fn(),
      create:    vi.fn(),
      update:    vi.fn(),
      delete:    vi.fn(),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

import { RatingQuery } from '../../../modules/rating/rating.query.js';
import { RatingMutation } from '../../../modules/rating/rating.mutation.js';
import {
  createRatingSchema,
  updateRatingSchema,
} from '../../../modules/rating/rating.validators.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_RATING = {
  id: 'rating-1',
  userId: 'user-1',
  stars: 5,
  comment: 'Great app!',
  edited: false,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z'),
  user: { id: 'user-1', name: 'Test User', image: null },
};

const MOCK_STATS = {
  _avg: { stars: 4.5 },
  _count: { stars: 10 },
};

const MOCK_DISTRIBUTION = [
  { stars: 1, _count: { stars: 1 } },
  { stars: 2, _count: { stars: 1 } },
  { stars: 3, _count: { stars: 2 } },
  { stars: 4, _count: { stars: 3 } },
  { stars: 5, _count: { stars: 3 } },
];

// ─────────────────────────────────────────────────────────────────────────────
// RatingQuery
// ─────────────────────────────────────────────────────────────────────────────

describe('RatingQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getRatings', () => {
    it('returns ratings with pagination and stats', async () => {
      (prisma.rating.findMany as any).mockResolvedValue([MOCK_RATING]);
      (prisma.rating.count as any).mockResolvedValue(10);
      (prisma.rating.aggregate as any).mockResolvedValue(MOCK_STATS);
      (prisma.rating.groupBy as any).mockResolvedValue(MOCK_DISTRIBUTION);

      const result = await RatingQuery.getRatings(1, 20);

      expect(result.ratings).toHaveLength(1);
      expect(result.pagination.totalCount).toBe(10);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasNext).toBe(false);
      expect(result.pagination.hasPrev).toBe(false);
      expect(result.stats.averageStars).toBe(4.5);
      expect(result.stats.totalRatings).toBe(10);
      expect(result.stats.distribution[5]).toBe(3);
    });

    it('calculates pagination correctly for page 2', async () => {
      (prisma.rating.findMany as any).mockResolvedValue([]);
      (prisma.rating.count as any).mockResolvedValue(25);
      (prisma.rating.aggregate as any).mockResolvedValue(MOCK_STATS);
      (prisma.rating.groupBy as any).mockResolvedValue([]);

      const result = await RatingQuery.getRatings(2, 10);

      expect(result.pagination.hasPrev).toBe(true);
      expect(result.pagination.hasNext).toBe(true);
      expect(prisma.rating.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('defaults distribution to 0 for empty star levels', async () => {
      (prisma.rating.findMany as any).mockResolvedValue([]);
      (prisma.rating.count as any).mockResolvedValue(0);
      (prisma.rating.aggregate as any).mockResolvedValue({ _avg: { stars: null }, _count: { stars: 0 } });
      (prisma.rating.groupBy as any).mockResolvedValue([]);

      const result = await RatingQuery.getRatings(1, 20);

      expect(result.stats.distribution[1]).toBe(0);
      expect(result.stats.distribution[3]).toBe(0);
      expect(result.stats.averageStars).toBe(0);
    });
  });

  describe('getRatingById', () => {
    it('returns a rating by id', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(MOCK_RATING);

      const result = await RatingQuery.getRatingById('rating-1');
      expect(result?.id).toBe('rating-1');
    });

    it('returns null for non-existent id', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(null);

      const result = await RatingQuery.getRatingById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getUserRating', () => {
    it('returns the user rating', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(MOCK_RATING);

      const result = await RatingQuery.getUserRating('user-1');
      expect(result?.userId).toBe('user-1');
    });

    it('returns null when user has no rating', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(null);

      const result = await RatingQuery.getUserRating('user-no-rating');
      expect(result).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RatingMutation
// ─────────────────────────────────────────────────────────────────────────────

describe('RatingMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createRating', () => {
    it('creates a rating when user has none', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(null);
      (prisma.rating.create as any).mockResolvedValue(MOCK_RATING);

      const result = await RatingMutation.createRating({
        userId: 'user-1',
        stars: 5,
        comment: 'Great app!',
      });

      expect(result.id).toBe('rating-1');
      expect(prisma.rating.create).toHaveBeenCalled();
    });

    it('throws ConflictError when user already has a rating', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(MOCK_RATING);

      await expect(
        RatingMutation.createRating({ userId: 'user-1', stars: 3 }),
      ).rejects.toThrow('already rated');
    });
  });

  describe('updateRating', () => {
    it('updates a rating owned by the user', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(MOCK_RATING);
      (prisma.rating.update as any).mockResolvedValue({
        ...MOCK_RATING,
        stars: 3,
        edited: true,
      });

      const result = await RatingMutation.updateRating(
        'rating-1',
        'user-1',
        { stars: 3 },
      );

      expect(result.stars).toBe(3);
      expect(result.edited).toBe(true);
    });

    it('throws NotFoundError when rating does not exist', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(null);

      await expect(
        RatingMutation.updateRating('nonexistent', 'user-1', { stars: 3 }),
      ).rejects.toThrow('Rating not found');
    });

    it('throws NotFoundError when user does not own the rating', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue({
        ...MOCK_RATING,
        userId: 'other-user',
      });

      await expect(
        RatingMutation.updateRating('rating-1', 'user-1', { stars: 3 }),
      ).rejects.toThrow('Rating not found');
    });
  });

  describe('deleteRating', () => {
    it('deletes a rating owned by the user', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(MOCK_RATING);
      (prisma.rating.delete as any).mockResolvedValue(undefined);

      await expect(
        RatingMutation.deleteRating('rating-1', 'user-1'),
      ).resolves.toBeUndefined();
      expect(prisma.rating.delete).toHaveBeenCalledWith({ where: { id: 'rating-1' } });
    });

    it('throws NotFoundError when rating does not exist', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue(null);

      await expect(
        RatingMutation.deleteRating('nonexistent', 'user-1'),
      ).rejects.toThrow('Rating not found');
    });

    it('throws NotFoundError when user does not own the rating', async () => {
      (prisma.rating.findUnique as any).mockResolvedValue({
        ...MOCK_RATING,
        userId: 'other-user',
      });

      await expect(
        RatingMutation.deleteRating('rating-1', 'user-1'),
      ).rejects.toThrow('Rating not found');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────────────────

describe('rating.validators', () => {
  describe('createRatingSchema', () => {
    it('accepts valid stars and optional comment', () => {
      const result = createRatingSchema.safeParse({ stars: 4, comment: 'Nice!' });
      expect(result.success).toBe(true);
    });

    it('accepts valid stars without comment', () => {
      const result = createRatingSchema.safeParse({ stars: 5 });
      expect(result.success).toBe(true);
    });

    it('accepts null comment', () => {
      const result = createRatingSchema.safeParse({ stars: 3, comment: null });
      expect(result.success).toBe(true);
    });

    it('rejects stars below 1', () => {
      const result = createRatingSchema.safeParse({ stars: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects stars above 5', () => {
      const result = createRatingSchema.safeParse({ stars: 6 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer stars', () => {
      const result = createRatingSchema.safeParse({ stars: 3.5 });
      expect(result.success).toBe(false);
    });

    it('rejects comment over 2000 chars', () => {
      const result = createRatingSchema.safeParse({ stars: 4, comment: 'x'.repeat(2001) });
      expect(result.success).toBe(false);
    });

    it('accepts comment at exactly 2000 chars', () => {
      const result = createRatingSchema.safeParse({ stars: 4, comment: 'x'.repeat(2000) });
      expect(result.success).toBe(true);
    });
  });

  describe('updateRatingSchema', () => {
    it('accepts partial update with only stars', () => {
      const result = updateRatingSchema.safeParse({ stars: 3 });
      expect(result.success).toBe(true);
    });

    it('accepts partial update with only comment', () => {
      const result = updateRatingSchema.safeParse({ comment: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('accepts empty update object', () => {
      const result = updateRatingSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects invalid stars in update', () => {
      const result = updateRatingSchema.safeParse({ stars: 0 });
      expect(result.success).toBe(false);
    });
  });
});
