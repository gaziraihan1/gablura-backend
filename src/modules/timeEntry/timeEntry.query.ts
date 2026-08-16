import { prisma }                          from '../../lib/prisma.js';
import type { MyTimeEntriesFilters }        from './timeEntry.types.js';
import { TimeEntryAccess }                  from './timeEntry.access.js';

const timeEntryUserInclude = {
  user: { select: { id: true, name: true, email: true, image: true } },
} as const;

const timeEntryTaskInclude = {
  task: {
    select: {
      id:       true,
      title:    true,
      project:  { select: { id: true, name: true } },
    },
  },
} as const;

export const TimeEntryQuery = {
  /** All entries logged on a task. Anyone with task access can see them. */
  async getTaskEntries(taskId: string, userId: string) {
    await TimeEntryAccess.assertTaskAccess(taskId, userId);

    return prisma.timeEntry.findMany({
      where:  { taskId },
      orderBy: { startedAt: 'desc' },
      include: timeEntryUserInclude,
    });
  },

  /** The requesting user's own entries, optionally scoped to a date range. */
  async getMyEntries(userId: string, filters: MyTimeEntriesFilters = {}) {
    const { from, to } = filters;

    return prisma.timeEntry.findMany({
      where: {
        userId,
        startedAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      orderBy: { startedAt: 'desc' },
      include: timeEntryTaskInclude,
    });
  },
};
