import { prisma } from '../../lib/prisma.js';

export const FavoriteQuery = {
  async getByUser(userId: string) {
    const favorites = await prisma.projectFavorite.findMany({
      where:  { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      include: {
        project: {
          select: {
            id: true,
            name: true,
            slug: true,
            color: true,
            status: true,
            workspace: { select: { slug: true } },
          },
        },
      },
    });

    const grouped = new Map<string, typeof favorites>();
    const ungrouped: typeof favorites = [];

    for (const fav of favorites) {
      if (fav.group) {
        const existing = grouped.get(fav.group) ?? [];
        existing.push(fav);
        grouped.set(fav.group, existing);
      } else {
        ungrouped.push(fav);
      }
    }

    return {
      grouped: Array.from(grouped.entries()).map(([group, items]) => ({
        group,
        favorites: items,
      })),
      ungrouped,
    };
  },

  async isFavorited(projectId: string, userId: string) {
    const fav = await prisma.projectFavorite.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    return !!fav;
  },
};
