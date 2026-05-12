/**
 * src/modules/notification/notification.query.ts
 *
 * All notification READ operations.
 *
 * prismaRead (replica) — for the paginated list. Called on every page load by
 *   every user; slight replication lag is invisible in practice.
 *
 * prisma (primary) — for the unread count badge. Must reflect the instant a
 *   mark-as-read mutation completes, so we hit primary.
 *
 * Method names are kept exactly as the existing controller expects:
 *   getUserNotification(userId, cursor)  ← cursor-based infinite scroll
 *   getUnreadCount(userId)              ← badge count
 */

import { prismaRead, prisma } from "../../lib/prisma.js";
import { notificationInclude } from "./notification.selects.js";

const PAGE_SIZE = 20;

export const NotificationQuery = {
  /**
   * Cursor-based paginated list.
   * Uses the read replica — high frequency, tolerance for slight lag.
   *
   * Returns the shape the frontend expects:
   *   { items, nextCursor, hasMore }
   */
  async getUserNotification(userId: string, cursor?: string) {
    const notifications = await prismaRead.notification.findMany({
      where: { userId },
      include: notificationInclude,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE + 1,           // fetch one extra to determine hasMore
      ...(cursor
        ? { skip: 1, cursor: { id: cursor } }
        : {}),
    });

    const hasMore = notifications.length > PAGE_SIZE;
    const items = hasMore ? notifications.slice(0, PAGE_SIZE) : notifications;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor, hasMore };
  },

  /**
   * Unread count for the notification badge.
   * Uses PRIMARY — must be consistent immediately after mark-as-read.
   */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await prisma.notification.count({
      where: { userId, read: false },
    });
    return { count };
  },
};