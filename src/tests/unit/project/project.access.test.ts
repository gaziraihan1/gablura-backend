import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectAccess } from "../../../modules/project/project.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: { findFirst: vi.fn() },
    project: { findFirst: vi.fn(), findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
  },
}));

describe("ProjectAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertWorkspaceAccess", () => {
    it("should allow workspace owner or member access", async () => {
      (prisma.workspace.findFirst as any).mockResolvedValue({ id: "ws1" });
      await expect(ProjectAccess.assertWorkspaceAccess("u1", "ws1")).resolves.toBeDefined();
    });

    it("should cache workspace access on subsequent calls", async () => {
      (prisma.workspace.findFirst as any).mockResolvedValue({ id: "ws1" });
      await ProjectAccess.assertWorkspaceAccess("u1", "ws1");
      expect(prisma.workspace.findFirst).toHaveBeenCalledTimes(1);

      await ProjectAccess.assertWorkspaceAccess("u1", "ws1");
      expect(prisma.workspace.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should throw ForbiddenError if no access", async () => {
      (prisma.workspace.findFirst as any).mockResolvedValue(null);
      await expect(ProjectAccess.assertWorkspaceAccess("u1", "ws1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("assertProjectAdminAccess", () => {
    it("should allow workspace owner/admin access", async () => {
      (prisma.project.findFirst as any).mockResolvedValueOnce({ id: "p1", workspace: { id: "ws1" } });
      await expect(ProjectAccess.assertProjectAdminAccess("u1", "p1")).resolves.toBeDefined();
    });

    it("should cache project admin access on subsequent calls", async () => {
      (prisma.project.findFirst as any).mockResolvedValue({ id: "p1", workspace: { id: "ws1" } });
      await ProjectAccess.assertProjectAdminAccess("u1", "p1");
      expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);

      await ProjectAccess.assertProjectAdminAccess("u1", "p1");
      expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should allow project MANAGER role access", async () => {
      (prisma.project.findFirst as any).mockResolvedValueOnce(null);
      (prisma.project.findFirst as any).mockResolvedValueOnce({ id: "p1", workspace: { id: "ws1" } });
      await expect(ProjectAccess.assertProjectAdminAccess("u1", "p1")).resolves.toBeDefined();
    });

    it("should throw ForbiddenError if user is not admin or manager", async () => {
      (prisma.project.findFirst as any).mockResolvedValueOnce(null);
      (prisma.project.findFirst as any).mockResolvedValueOnce(null);
      await expect(ProjectAccess.assertProjectAdminAccess("u1", "p1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("assertProjectAccess", () => {
    it("should allow project member access", async () => {
      (prisma.project.findFirst as any).mockResolvedValue({ id: "p1" });
      await expect(ProjectAccess.assertProjectAccess("u1", "p1")).resolves.toBeDefined();
    });

    it("should cache project access on subsequent calls", async () => {
      (prisma.project.findFirst as any).mockResolvedValue({ id: "p1" });
      await ProjectAccess.assertProjectAccess("u1", "p1");
      expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);

      await ProjectAccess.assertProjectAccess("u1", "p1");
      expect(prisma.project.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should throw NotFoundError if project does not exist", async () => {
      (prisma.project.findFirst as any).mockResolvedValue(null);
      (prisma.project.findUnique as any).mockResolvedValue(null);
      await expect(ProjectAccess.assertProjectAccess("u1", "p1")).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if project exists but user has no access", async () => {
      (prisma.project.findFirst as any).mockResolvedValue(null);
      (prisma.project.findUnique as any).mockResolvedValue({ id: "p1" });
      await expect(ProjectAccess.assertProjectAccess("u1", "p1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("assertProjectNotArchived", () => {
    it("should pass if project is not archived", async () => {
      (prisma.project.findUnique as any).mockResolvedValue({ status: "ACTIVE", name: "P1" });
      await expect(ProjectAccess.assertProjectNotArchived("p1")).resolves.toBeUndefined();
    });

    it("should throw ForbiddenError if project is archived", async () => {
      (prisma.project.findUnique as any).mockResolvedValue({ status: "ARCHIVED", name: "P1" });
      await expect(ProjectAccess.assertProjectNotArchived("p1")).rejects.toThrow(ForbiddenError);
    });

    it("should throw NotFoundError if project does not exist", async () => {
      (prisma.project.findUnique as any).mockResolvedValue(null);
      await expect(ProjectAccess.assertProjectNotArchived("p1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("isProjectAdmin", () => {
    it("should return true if user is workspace owner", async () => {
      const result = await ProjectAccess.isProjectAdmin("u1", { workspace: { id: "ws1", ownerId: "u1" } } as any);
      expect(result).toBe(true);
    });

    it("should return true if user is workspace admin/owner member", async () => {
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: "wm1" });
      const result = await ProjectAccess.isProjectAdmin("u1", { workspace: { id: "ws1", ownerId: "u2" } } as any);
      expect(result).toBe(true);
    });

    it("should return false if workspace is null", async () => {
      const result = await ProjectAccess.isProjectAdmin("u1", { workspace: null } as any);
      expect(result).toBe(false);
    });

    it("should return false if user is not admin", async () => {
      (prisma.workspaceMember.findFirst as any).mockResolvedValue(null);
      const result = await ProjectAccess.isProjectAdmin("u1", { workspace: { id: "ws1", ownerId: "u2" } } as any);
      expect(result).toBe(false);
    });
  });
});
