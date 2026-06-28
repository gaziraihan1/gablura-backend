import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceUsageAccess } from "../../../modules/workspaceUsage/workspaceUsage.access.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspaceMember: {
      findUnique: vi.fn(),
    },
  },
}));

describe("WorkspaceUsageAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertWorkspaceMember", () => {
    it("returns the member role when the user belongs to the workspace", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ role: "ADMIN" } as any);

      await expect(
        WorkspaceUsageAccess.assertWorkspaceMember("user-1", "workspace-1"),
      ).resolves.toEqual({ role: "ADMIN" });

      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: "user-1", workspaceId: "workspace-1" } },
        select: { role: true },
      });
    });

    it("throws an access error when the user is not a workspace member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await expect(
        WorkspaceUsageAccess.assertWorkspaceMember("user-1", "workspace-1"),
      ).rejects.toThrow("You do not have access to this workspace");
    });
  });

  describe("isAdmin", () => {
    it.each([
      ["OWNER", true],
      ["ADMIN", true],
      ["MEMBER", false],
      ["GUEST", false],
    ])("returns %s for role %s", (role, expected) => {
      expect(WorkspaceUsageAccess.isAdmin(role)).toBe(expected);
    });
  });
});