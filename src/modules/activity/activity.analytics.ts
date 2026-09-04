
import { prisma } from '../../lib/prisma.js';
import type { ActivityStats } from './activity.types.js';
import { ActivityQuery } from './activity.query.js';

export const ActivityAnalytics = {
  async getUserActivityStats(
    userId: string,
    workspaceId?: string,
  ): Promise<ActivityStats> {
    const where: Record<string, unknown> = {
      OR: [
        { userId },
        {
          workspace: {
            OR: [
              { ownerId: userId },
              { members: { some: { userId } } },
            ],
          },
        },
      ],
    };

    if (workspaceId) where.workspaceId = workspaceId;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Gablura-admin audit rows (metadata.source === 'gablura-admin', e.g. AI cap
    // changes) are excluded from user-facing stats. The positive JSON-path
    // filter is reliable (a negated one would drop rows lacking the key due to
    // SQL NULL semantics), so count them separately and subtract.
    const adminWhere = {
      ...where,
      metadata: { path: ['source'], equals: 'gablura-admin' },
    };

    const [total, today, actionCounts, adminTotal, adminToday] = await Promise.all([
      prisma.activity.count({ where }),

      prisma.activity.count({
        where: { ...where, createdAt: { gte: startOfToday } },
      }),

      prisma.activity.groupBy({
        by: ['action'],
        where,
        _count: true,
      }),

      prisma.activity.count({ where: adminWhere }),
      prisma.activity.count({
        where: { ...adminWhere, createdAt: { gte: startOfToday } },
      }),
    ]);

    const byAction = actionCounts.reduce<Record<string, number>>((acc, item) => {
      acc[item.action] = item._count;
      return acc;
    }, {});

    // All admin audit rows are action 'UPDATED' — subtract them consistently.
    return {
      total: Math.max(0, total - adminTotal),
      today: Math.max(0, today - adminToday),
      byAction: {
        ...byAction,
        UPDATED: Math.max(0, (byAction.UPDATED ?? 0) - adminTotal),
      },
    };
  },

  async getGroupedActivities(
    userId: string,
    workspaceId?: string,
    days = 7,
  ) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const activities = await ActivityQuery.getUserActivities(userId, {
      workspaceId,
      startDate,
      limit: 100,
    });

    return activities.reduce<Record<string, typeof activities>>((acc, activity) => {
      const date = new Date(activity.createdAt).toLocaleDateString();
      if (!acc[date]) acc[date] = [];
      acc[date].push(activity);
      return acc;
    }, {});
  },
};