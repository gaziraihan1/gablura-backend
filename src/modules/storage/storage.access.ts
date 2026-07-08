import { prisma }                              from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError }       from '../../errors/index.js';
import { CacheClient, CACHE_KEYS, CACHE_TTL } from '../../lib/redis/cache.client.js';

export const StorageAccess = {
  async getUserRole(userId: string, workspaceId: string): Promise<string | null> {
    const key = CACHE_KEYS.userPermissions(userId, workspaceId);
    const cached = await CacheClient.get<string>(key);
    if (cached !== null) {
      return cached === 'none' ? null : cached;
    }

    const member = await prisma.workspaceMember.findUnique({
      where:  { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });

    const role = member?.role ?? null;
    await CacheClient.set(key, role ?? 'none', CACHE_TTL.USER_PERMISSIONS);
    return role;
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
    const cacheKey = CACHE_KEYS.storageMemberWithWorkspace(workspaceId, userId);
    const cached = await CacheClient.get<{ workspace: any; role: string }>(cacheKey);
    if (cached !== null) {
      return cached;
    }

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

    const result = { workspace, role: member.role };
    await CacheClient.set(cacheKey, result, CACHE_TTL.ACCESS_CONTROL_WORKSPACE_MEMBER);
    return result;
  },
};