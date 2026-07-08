import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";
import { CacheClient, CACHE_KEYS, CACHE_TTL } from "../../lib/redis/cache.client.js";

export const WorkspaceAccess = {
  async assertViewer(workspaceId: string, userId: string) {
    const workspace = await prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [{ isPublic: true }, { members: { some: { userId } } }],
      },
      select: {
        id: true,
        isPublic: true,
        members: {
          where: { userId },
          select: { id: true, role: true },
          take: 1,
        },
      },
    });
    if (!workspace) throw new NotFoundError("Workspace");
    return {
      isMember: workspace.members.length > 0,
      isPublic: workspace.isPublic,
      member: workspace.members[0] ?? null,
    };
  },

  async assertMember(workspaceId: string, userId: string) {
    const cacheKey = CACHE_KEYS.workspaceMember(workspaceId, userId);
    const member = await CacheClient.getOrSet(
      cacheKey,
      () =>
        prisma.workspaceMember.findFirst({
          where: { workspaceId, userId },
        }),
      CACHE_TTL.ACCESS_CONTROL_WORKSPACE_MEMBER,
    );
    if (!member) throw new ForbiddenError("You are not a member of this workspace");
    return member;
  },

  async assertAdmin(workspaceId: string, userId: string) {
    const cacheKey = CACHE_KEYS.workspaceAdmin(workspaceId, userId);
    const member = await CacheClient.getOrSet(
      cacheKey,
      () =>
        prisma.workspaceMember.findFirst({
          where: { workspaceId, userId, role: { in: ["OWNER", "ADMIN"] } },
        }),
      CACHE_TTL.ACCESS_CONTROL_WORKSPACE_ADMIN,
    );
    if (!member) throw new ForbiddenError("Admin access required");
    return member;
  },

  async assertOwner(workspaceId: string, userId: string) {
    const cacheKey = CACHE_KEYS.workspaceOwner(workspaceId, userId);
    const workspace = await CacheClient.getOrSet(
      cacheKey,
      () =>
        prisma.workspace.findFirst({
          where: { id: workspaceId, ownerId: userId },
        }),
      CACHE_TTL.ACCESS_CONTROL_WORKSPACE_OWNER,
    );
    if (!workspace) throw new ForbiddenError("Owner access required");
    return workspace;
  },
};