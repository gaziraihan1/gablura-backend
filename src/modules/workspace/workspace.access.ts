import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";

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
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
    });
    if (!member) throw new ForbiddenError("You are not a member of this workspace");
    return member;
  },

  async assertAdmin(workspaceId: string, userId: string) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId, role: { in: ["OWNER", "ADMIN"] } },
    });
    if (!member) throw new ForbiddenError("Admin access required");
    return member;
  },

  async assertOwner(workspaceId: string, userId: string) {
    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerId: userId },
    });
    if (!workspace) throw new ForbiddenError("Owner access required");
    return workspace;
  },
};