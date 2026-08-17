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
   * Entries on tasks in a workspace that the requesting user can access.
   * Role-scoped: OWNER/ADMIN see every member's entries (optionally filtered
   * to one member via `memberUserId`); MEMBER/GUEST see only their own and
   * any `memberUserId` filter is ignored. The workspace membership gate runs
   * first; then the task-access OR rule keeps the list limited to tasks the
   * user could log time on.
   */
  async getWorkspaceEntries(
    workspaceId: string,
    userId: string,
    filters: MyTimeEntriesFilters = {},
  ) {
    const role = await TimeEntryAccess.assertWorkspaceMembership(workspaceId, userId);
    const isPrivileged = role === 'OWNER' || role === 'ADMIN';

    const { from, to, memberUserId } = filters;

    // OWNER/ADMIN: everyone (or one member when filtered). MEMBER/GUEST:
    // always their own entries — a member-supplied memberUserId is ignored
    // so a regular user can never peek at another member's time log.
    const scopedUserId = isPrivileged ? memberUserId : userId;

    return prisma.timeEntry.findMany({
      where: {
        task: buildAccessibleWorkspaceTasksWhere(workspaceId, userId),
        ...(scopedUserId ? { userId: scopedUserId } : {}),
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
