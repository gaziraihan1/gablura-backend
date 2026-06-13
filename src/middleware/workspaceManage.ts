import { prisma } from "../lib/prisma.js";

const workspaceManageMiddleware = {
  async canAccessWorkspace(userId: string, workspaceId: string): Promise<boolean> {
      const workspace = await prisma.workspace.findFirst({
        where: {
          id: workspaceId,
          OR: [
            { ownerId: userId },
            { members: { some: { userId } } },
          ],
        },
      });
      return !!workspace;
    },
    async isPublicWorkspace(workspaceId: string): Promise<boolean> {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { isPublic: true },
      });
      return workspace?.isPublic ?? false;
    },
};

export default workspaceManageMiddleware;