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
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: null,
      } as any);
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({
        role: "ADMIN",
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(true);
    });

    it("should allow workspace OWNER to edit", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: null,
      } as any);
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        id: "ws1",
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(true);
    });

    it("should allow project MANAGER to edit", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: "p1",
      } as any);
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({
        role: "MEMBER",
      } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.projectMember.findFirst).mockResolvedValue({
        id: "pm1",
      } as any);

      const result = await TaskAccess.checkEditPermission("t1", "u2");
      expect(result.canEdit).toBe(true);
    });

    it("should deny if no permission", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
        projectId: "p1",
      } as any);
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({
        role: "MEMBER",
      } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.projectMember.findFirst).mockResolvedValue(null);

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
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: "t1",
        createdById: "u1",
        workspaceId: "ws1",
      } as any);
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({
        role: "ADMIN",
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
});
