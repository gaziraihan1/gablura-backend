import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskAccess } from "../../../modules/task/task.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
    projectMember: {
      findFirst: vi.fn(),
    },
  },
}));

describe("TaskAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkEditPermission", () => {
    it("should allow task owner to edit", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: null,
        projectId: null,
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u1");
      expect(result.canEdit).toBe(true);
    });

    it("should cache edit permission on subsequent calls", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: null,
        projectId: null,
      } as any);

      await TaskAccess.checkEditPermission("t1", "u1");
      expect(prisma.task.findFirst).toHaveBeenCalledTimes(1);

      await TaskAccess.checkEditPermission("t1", "u1");
      expect(prisma.task.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should deny non-owner for personal tasks", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: null,
        projectId: null,
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(false);
      expect(result.reason).toContain("Only the task owner can edit personal tasks");
    });

    it("should allow workspace ADMIN to edit", async () => {
      // Single query with nested includes — workspace.members has ADMIN role
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: null,
        workspace: { ownerId: "u3", members: [{ role: "ADMIN" }] },
        project: { members: [] },
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(true);
    });

    it("should allow workspace OWNER to edit", async () => {
      // Single query with nested includes — workspace.ownerId matches userId
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: null,
        workspace: { ownerId: "u2", members: [] },
        project: { members: [] },
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(true);
    });

    it("should allow project MANAGER to edit", async () => {
      // Single query with nested includes — project.members has a MANAGER entry
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: "p1",
        workspace: { ownerId: "u3", members: [] },
        project: { members: [{ id: "pm1" }] },
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(true);
    });

    it("should deny if no permission", async () => {
      // Single query with nested includes — no admin/owner/manager match
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: "p1",
        workspace: { ownerId: "u3", members: [] },
        project: { members: [] },
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(false);
    });

    it("should return error if task not found", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      const result = await TaskAccess.checkEditPermission("t1", "u1");
      expect(result.canEdit).toBe(false);
      expect(result.reason).toBe("Task not found");
    });
  });

  describe("assertDeletePermission", () => {
    it("should allow creator to delete", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: null,
      } as any);

      const result = await TaskAccess.assertDeletePermission("t1", "u1");
      expect(result.id).toBe("t1");
    });

    it("should allow workspace ADMIN to delete", async () => {
      // Single query with nested includes — workspace.members has ADMIN role
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        workspace: { ownerId: "u3", members: [{ role: "ADMIN" }] },
      } as any);

      const result = await TaskAccess.assertDeletePermission("t1", "u2");
      expect(result.id).toBe("t1");
    });

    it("should deny non-creator for personal tasks", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: null,
      } as any);

      await expect(TaskAccess.assertDeletePermission("t1", "u2")).rejects.toThrow(ForbiddenError);
    });

    it("should throw ForbiddenError if task not found", async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue(null);
      await expect(TaskAccess.assertDeletePermission("t1", "u1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("assertTaskAccess", () => {
    it("should allow workspace owner/member access", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1" } as any);
      const result = await TaskAccess.assertTaskAccess("t1", "u1");
      expect(result.id).toBe("t1");
    });

    it("should cache task access on subsequent calls", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1" } as any);
      await TaskAccess.assertTaskAccess("t1", "u1");
      expect(prisma.task.findFirst).toHaveBeenCalledTimes(1);

      await TaskAccess.assertTaskAccess("t1", "u1");
      expect(prisma.task.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should throw NotFoundError if task not found", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(TaskAccess.assertTaskAccess("t1", "u1")).rejects.toThrow(NotFoundError);
    });
  });
});
