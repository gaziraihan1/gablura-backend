import { prisma } from '../../lib/prisma.js';
import { notificationInclude } from './notification.selects.js';
import type { CreateNotificationInput } from './notification.types.js';
import { NotificationCache } from '../../lib/redis/cache.client.js';

export const NotificationMutation = {
  async create(data: CreateNotificationInput) {
    return prisma.notification.create({
      data,
      include: notificationInclude,
    });
  },

  async markAsRead(notificationId: string, userId: string) {
    return prisma.notification.update({
      where: { id: notificationId, userId },
      data: { read: true, readAt: new Date() },
    });
  },

  async markAllAsRead(userId: string) {
    const result = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });

    await NotificationCache.invalidateAll(userId);

    return { count: result.count };
  },

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    await prisma.notification.delete({ where: { id: notificationId, userId } });
  },

  async deleteAllReadNotifications(userId: string) {
    const result = await prisma.notification.deleteMany({
      where: { userId, read: true },
    });
    return { count: result.count };
  },

  async deleteOldReadNotifications(daysOld: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const result = await prisma.notification.deleteMany({
      where: { read: true, readAt: { lt: cutoffDate } },
    });
    return { count: result.count };
  },
};