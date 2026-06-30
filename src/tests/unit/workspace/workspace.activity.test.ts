import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceActivity } from "../../../modules/workspace/workspace.activity.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    activity: {
      create: vi.fn(),
    },
  },
}));

describe("WorkspaceActivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logCreated", () => {
    it("creates an activity record for workspace creation", async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await WorkspaceActivity.logCreated({
        workspaceId: "ws-1",
        workspaceSlug: "test-ws",
        userId: "user-1",
        workspaceName: "Test Workspace",
      });

      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "CREATED",
            entityType: "WORKSPACE",
            entityId: "ws-1",
            userId: "user-1",
            workspaceId: "ws-1",
            workspaceSlug: "test-ws",
            metadata: { workspaceName: "Test Workspace" },
          }),
        }),
      );
    });

    it("does not throw when prisma fails (fire-and-forget)", async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        WorkspaceActivity.logCreated({
          workspaceId: "ws-1",
          workspaceSlug: "test-ws",
          userId: "user-1",
          workspaceName: "Test Workspace",
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("logUpdated", () => {
    it("creates an activity record for workspace update", async () => {
      vi.mocked(prisma.activity.create).mockResolvedValue({} as any);

      await WorkspaceActivity.logUpdated({
        workspaceId: "ws-1",
        workspaceSlug: "test-ws",
        userId: "user-1",
      });

      expect(prisma.activity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: "UPDATED",
            entityType: "WORKSPACE",
            entityId: "ws-1",
            userId: "user-1",
            workspaceId: "ws-1",
            workspaceSlug: "test-ws",
          }),
        }),
      );
    });

    it("does not throw when prisma fails (fire-and-forget)", async () => {
      vi.mocked(prisma.activity.create).mockRejectedValue(
        new Error("DB error"),
      );

      await expect(
        WorkspaceActivity.logUpdated({
          workspaceId: "ws-1",
          workspaceSlug: "test-ws",
          userId: "user-1",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
