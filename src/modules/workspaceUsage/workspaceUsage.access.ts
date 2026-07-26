import { prisma } from "../../lib/prisma.js";
import { ForbiddenError } from "../../errors/index.js";

export const WorkspaceUsageAccess = {
  async assertWorkspaceMember(userId: string, workspaceId: string) {
    const member = await prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true },
    });
    if (!member) throw new ForbiddenError("You do not have access to this workspace");
    return member;
  },

  isAdmin(role: string): boolean {
    return role === "OWNER" || role === "ADMIN";
  },
};
