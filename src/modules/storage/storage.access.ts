import { prisma }                              from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError }       from '../../errors/index.js';

export const StorageAccess = {
  async getUserRole(userId: string, workspaceId: string): Promise<string | null> {
    const member = await prisma.workspaceMember.findUnique({
      where:  { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });
    return member?.role ?? null;
  },

  async assertMember(userId: string, workspaceId: string): Promise<string> {
    const role = await this.getUserRole(userId, workspaceId);
    if (!role) throw new ForbiddenError('You do not have access to this workspace');
    return role;
  },

  async isAdmin(userId: string, workspaceId: string): Promise<boolean> {
    const role = await this.getUserRole(userId, workspaceId);
    return role === 'OWNER' || role === 'ADMIN';
  },

  async assertAdmin(userId: string, workspaceId: string): Promise<void> {
    const isAdmin = await this.isAdmin(userId, workspaceId);
    if (!isAdmin) throw new ForbiddenError('Only workspace owners and admins can perform this action');
  },

  async assertMemberWithWorkspace(userId: string, workspaceId: string) {
    const [member, workspace] = await Promise.all([
      prisma.workspaceMember.findUnique({
        where:  { userId_workspaceId: { userId, workspaceId } },
        select: { role: true },
      }),
      prisma.workspace.findUnique({
        where:  { id: workspaceId },
        select: { id: true, name: true, plan: true, maxStorage: true },
      }),
    ]);

    if (!member)    throw new ForbiddenError('You do not have access to this workspace');
    if (!workspace) throw new NotFoundError('Workspace');

    return { workspace, role: member.role };
  },
};