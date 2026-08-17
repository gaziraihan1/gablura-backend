import { prisma }                       from '../../lib/prisma.js';
import { NotFoundError, ForbiddenError } from '../../errors/index.js';

export const TimeEntryAccess = {
  /**
   * Throws unless the user is a member (or the owner) of the workspace.
   * Used to gate the workspace-scoped time log — every member can view
   * the workspace's time entries.
   *
   * Returns the requester's role: OWNER for the workspace owner, otherwise
   * the member's stored role (ADMIN / MEMBER / GUEST). The role drives what
   * the workspace time log shows (OWNER/ADMIN see everyone's entries,
   * MEMBER/GUEST only their own).
   */
  async assertWorkspaceMembership(
    workspaceId: string,
    userId: string,
  ): Promise<'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST'> {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ownerId: true,
        members: { where: { userId }, select: { role: true }, take: 1 },
      },
    });

    if (!workspace) throw new NotFoundError('Workspace', 'WORKSPACE_NOT_FOUND');
    if (workspace.ownerId === userId) return 'OWNER';
    const member = workspace.members[0];
    if (!member) {
      throw new ForbiddenError('You are not a member of this workspace');
    }
    return member.role;
  },

  /**
   * A user may log time on a task they can see: creator, assignee,
   * project member, or workspace owner/admin. Mirrors the comment module.
   */
  async assertTaskAccess(taskId: string, userId: string) {
    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
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
      select: { id: true, workspaceId: true },
    });

    if (!task) throw new NotFoundError('Task', 'TASK_NOT_FOUND');
    return task;
  },

  /**
   * Time entries are personal records — only the author can edit or
   * delete them.
   */
  async assertEntryOwnership(entryId: string, userId: string) {
    const entry = await prisma.timeEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry) throw new NotFoundError('Time entry', 'TIME_ENTRY_NOT_FOUND');
    if (entry.userId !== userId) {
      throw new ForbiddenError('You can only modify your own time entries');
    }

    return entry;
  },
};
