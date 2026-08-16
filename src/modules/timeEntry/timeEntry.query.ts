import { prisma }                          from '../../lib/prisma.js';
import type { Prisma }                     from '@prisma/client';
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

/**
 * Tasks in a workspace the user may see: creator, assignee, project member,
 * or workspace owner/admin. Mirrors TimeEntryAccess.assertTaskAccess so the
 * workspace time log only surfaces entries on tasks the user could log time on.
 */
function buildAccessibleWorkspaceTasksWhere(
  workspaceId: string,
  userId: string,
): Prisma.TaskWhereInput {
  return {
    AND: [
      {
        OR: [
          { workspaceId },
          { project: { workspaceId } },
        ],
      },
      {
        OR: [
          { createdById: userId },
          { assignees: { some: { userId } } },
          { project:   { members: { some: { userId } } } },
          {
            workspace: {
              OR: [
                { ownerId: userId },
                { members: { some: { userId, role: 'ADMIN' } } },
              ],
            },
          },
        ],
      },
    ],
  };
}

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

  /**
   * Every entry on tasks in a workspace that the requesting user can access.
   * The workspace membership gate runs first; then the task-access OR rule
   * keeps the list limited to tasks the user could log time on.
   */
  async getWorkspaceEntries(
    workspaceId: string,
    userId: string,
    filters: MyTimeEntriesFilters = {},
  ) {
    await TimeEntryAccess.assertWorkspaceMembership(workspaceId, userId);

    const { from, to } = filters;

    return prisma.timeEntry.findMany({
      where: {
        task: buildAccessibleWorkspaceTasksWhere(workspaceId, userId),
        startedAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      },
      orderBy: { startedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
        task: {
          select: {
            id:       true,
            title:    true,
            project:  { select: { id: true, name: true } },
          },
        },
      },
    });
  },
};
