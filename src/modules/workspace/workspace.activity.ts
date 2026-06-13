import { prisma } from "../../lib/prisma.js";

export const WorkspaceActivity = {
  async logCreated(params: {
    workspaceId: string;
    workspaceSlug: string;
    userId: string;
    workspaceName: string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action: "CREATED",
          entityType: "WORKSPACE",
          entityId: params.workspaceId,
          userId: params.userId,
          workspaceId: params.workspaceId,
          workspaceSlug: params.workspaceSlug,
          metadata: { workspaceName: params.workspaceName },
        },
      });
    } catch (error) {
      console.error("Failed to log workspace creation:", error);
    }
  },

  async logUpdated(params: {
    workspaceId: string;
    workspaceSlug: string;
    userId: string;
  }): Promise<void> {
    try {
      await prisma.activity.create({
        data: {
          action: "UPDATED",
          entityType: "WORKSPACE",
          entityId: params.workspaceId,
          workspaceSlug: params.workspaceSlug,
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
      });
    } catch (error) {
      console.error("Failed to log workspace update:", error);
    }
  },
};
