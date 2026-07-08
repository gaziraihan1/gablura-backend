import { describe, it, expect, vi, beforeEach } from "vitest";
import { StorageAccess } from "../../../modules/storage/storage.access.js";
import { ForbiddenError, NotFoundError } from "../../../errors/AppError.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspaceMember: {
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

describe("StorageAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserRole", () => {
    it("should return user role when member exists", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);

      const role = await StorageAccess.getUserRole("user1", "workspace1");
      expect(role).toBe("ADMIN");
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
        where: { userId_workspaceId: { userId: "user1", workspaceId: "workspace1" } },
        select: { role: true },
      });
    });

    it("should cache user role on subsequent calls", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);

      await StorageAccess.getUserRole("user1", "workspace1");
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledTimes(1);

      await StorageAccess.getUserRole("user1", "workspace1");
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should return null when member does not exist", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      const role = await StorageAccess.getUserRole("user1", "workspace1");
      expect(role).toBeNull();
    });
  });

  describe("assertMember", () => {
    it("should return role when user is a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "MEMBER",
      } as any);

      const role = await StorageAccess.assertMember("user1", "workspace1");
      expect(role).toBe("MEMBER");
    });

    it("should throw ForbiddenError when user is not a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await expect(StorageAccess.assertMember("user1", "workspace1")).rejects.toThrow(
        ForbiddenError,
      );
      await expect(StorageAccess.assertMember("user1", "workspace1")).rejects.toThrow(
        "You do not have access to this workspace",
      );
    });
  });

  describe("isAdmin", () => {
    it("should return true for OWNER role", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "OWNER",
      } as any);

      const isAdmin = await StorageAccess.isAdmin("user1", "workspace1");
      expect(isAdmin).toBe(true);
    });

    it("should return true for ADMIN role", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);

      const isAdmin = await StorageAccess.isAdmin("user1", "workspace1");
      expect(isAdmin).toBe(true);
    });

    it("should return false for MEMBER role", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "MEMBER",
      } as any);

      const isAdmin = await StorageAccess.isAdmin("user1", "workspace1");
      expect(isAdmin).toBe(false);
    });

    it("should return false when user is not a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      const isAdmin = await StorageAccess.isAdmin("user1", "workspace1");
      expect(isAdmin).toBe(false);
    });
  });

  describe("assertAdmin", () => {
    it("should not throw for OWNER role", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "OWNER",
      } as any);

      await expect(StorageAccess.assertAdmin("user1", "workspace1")).resolves.not.toThrow();
    });

    it("should not throw for ADMIN role", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);

      await expect(StorageAccess.assertAdmin("user1", "workspace1")).resolves.not.toThrow();
    });

    it("should throw ForbiddenError for MEMBER role", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "MEMBER",
      } as any);

      await expect(StorageAccess.assertAdmin("user1", "workspace1")).rejects.toThrow(
        ForbiddenError,
      );
      await expect(StorageAccess.assertAdmin("user1", "workspace1")).rejects.toThrow(
        "Only workspace owners and admins can perform this action",
      );
    });

    it("should throw ForbiddenError when user is not a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await expect(StorageAccess.assertAdmin("user1", "workspace1")).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("assertMemberWithWorkspace", () => {
    it("should return workspace and role when user is a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        id: "workspace1",
        name: "Test Workspace",
        plan: "PRO",
        maxStorage: 1000,
      } as any);

      const result = await StorageAccess.assertMemberWithWorkspace("user1", "workspace1");
      expect(result).toEqual({
        workspace: {
          id: "workspace1",
          name: "Test Workspace",
          plan: "PRO",
          maxStorage: 1000,
        },
        role: "ADMIN",
      });
    });

    it("should cache member and workspace info on subsequent calls", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        id: "workspace1",
        name: "Test Workspace",
        plan: "PRO",
        maxStorage: 1000,
      } as any);

      await StorageAccess.assertMemberWithWorkspace("user1", "workspace1");
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.workspace.findUnique).toHaveBeenCalledTimes(1);

      await StorageAccess.assertMemberWithWorkspace("user1", "workspace1");
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.workspace.findUnique).toHaveBeenCalledTimes(1);
    });

    it("should throw ForbiddenError when user is not a member", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({
        id: "workspace1",
        name: "Test Workspace",
        plan: "PRO",
        maxStorage: 1000,
      } as any);

      await expect(
        StorageAccess.assertMemberWithWorkspace("user1", "workspace1"),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        StorageAccess.assertMemberWithWorkspace("user1", "workspace1"),
      ).rejects.toThrow("You do not have access to this workspace");
    });

    it("should throw NotFoundError when workspace does not exist", async () => {
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        role: "ADMIN",
      } as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);

      await expect(
        StorageAccess.assertMemberWithWorkspace("user1", "workspace1"),
      ).rejects.toThrow(NotFoundError);
      await expect(
        StorageAccess.assertMemberWithWorkspace("user1", "workspace1"),
      ).rejects.toThrow("Workspace");
    });
  });
});
