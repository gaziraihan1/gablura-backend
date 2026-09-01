import { prisma } from '../../lib/prisma.js';
import { ratingFullInclude } from './rating.selects.js';

export const RatingQuery = {
  /**
   * Get all ratings with aggregate stats. Public — no auth required.
   */
  async getRatings(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [ratings, totalCount] = await Promise.all([
      prisma.rating.findMany({
        include: ratingFullInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      prisma.rating.count(),
    ]);

    // Compute aggregate stats
    const stats = await prisma.rating.aggregate({
      _avg: { stars: true },
      _count: { stars: true },
    });

    // Distribution: count per star level
    const distribution = await prisma.rating.groupBy({
      by: ['stars'],
      _count: { stars: true },
      orderBy: { stars: 'asc' },
    });

    const distributionMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const d of distribution) {
      distributionMap[d.stars] = d._count.stars;
    }

    return {
      ratings,
      pagination: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        hasNext: skip + pageSize < totalCount,
        hasPrev: page > 1,
      },
      stats: {
        averageStars: stats._avg.stars ?? 0,
        totalRatings: stats._count.stars ?? 0,
        distribution: distributionMap,
      },
    };
  },

  /**
   * Get a single rating by ID. Public — no auth required.
   */
  async getRatingById(id: string) {
    return prisma.rating.findUnique({
      where: { id },
      include: ratingFullInclude,
    });
  },

  /**
   * Get the current user's rating. Auth required.
   */
  async getUserRating(userId: string) {
    return prisma.rating.findUnique({
      where: { userId },
      include: ratingFullInclude,
    });
  },
};
