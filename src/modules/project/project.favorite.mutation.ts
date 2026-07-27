import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../errors/index.js';
import { ProjectAccess } from './project.access.js';
import { ProjectCache } from '../../lib/redis/cache.client.js';
import type { CreateFavoriteDto, UpdateFavoriteDto } from './project.favorite.types.js';

export const FavoriteMutation = {
  async add(data: CreateFavoriteDto) {
    await ProjectAccess.assertProjectAccess(data.userId, data.projectId);

    const existing = await prisma.projectFavorite.findUnique({
      where: { projectId_userId: { projectId: data.projectId, userId: data.userId } },
    });
    if (existing) return existing; // already favorited

    const maxOrder = await prisma.projectFavorite.aggregate({
      where: { userId: data.userId },
      _max:  { sortOrder: true },
    });

    const fav = await prisma.projectFavorite.create({
      data: {
        projectId: data.projectId,
        userId:    data.userId,
        group:     data.group,
        sortOrder: data.sortOrder ?? (maxOrder._max.sortOrder ?? -1) + 1,
        note:      data.note,
      },
    });

    ProjectCache.invalidateProject(data.projectId).catch(() => {});
    return fav;
  },

  async remove(projectId: string, userId: string) {
    const fav = await prisma.projectFavorite.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!fav) throw new NotFoundError('Favorite');

    await prisma.projectFavorite.delete({
      where: { projectId_userId: { projectId, userId } },
    });

    ProjectCache.invalidateProject(projectId).catch(() => {});
  },

  async toggle(projectId: string, userId: string) {
    const existing = await prisma.projectFavorite.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });

    if (existing) {
      await prisma.projectFavorite.delete({
        where: { projectId_userId: { projectId, userId } },
      });
      ProjectCache.invalidateProject(projectId).catch(() => {});
      return { favorited: false };
    }

    await this.add({ projectId, userId });
    return { favorited: true };
  },

  async update(projectId: string, userId: string, data: UpdateFavoriteDto) {
    const fav = await prisma.projectFavorite.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!fav) throw new NotFoundError('Favorite');

    const updated = await prisma.projectFavorite.update({
      where:  { projectId_userId: { projectId, userId } },
      data,
    });

    ProjectCache.invalidateProject(projectId).catch(() => {});
    return updated;
  },

  async reorder(userId: string, favoriteIds: string[]) {
    // Verify all favorites belong to this user
    const userFavorites = await prisma.projectFavorite.findMany({
      where: { userId, id: { in: favoriteIds } },
      select: { id: true },
    });
    if (userFavorites.length !== favoriteIds.length) {
      throw new NotFoundError('Some favorites not found');
    }

    await prisma.$transaction(
      favoriteIds.map((id, index) =>
        prisma.projectFavorite.update({
          where: { id },
          data:  { sortOrder: index },
        }),
      ),
    );
  },
};
