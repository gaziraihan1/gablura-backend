import { prisma }        from '../../lib/prisma.js';
import { ForbiddenError } from '../../errors/index.js';

export const FileManagementAccess = {
  async assertWorkspaceMember(userId: string, workspaceId: string) {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) throw new ForbiddenError('You do not have access to this workspace');
    return member;
  },

  async isWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    return member?.role === 'OWNER' || member?.role === 'ADMIN';
  },
};