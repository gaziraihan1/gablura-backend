import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubtaskAccess } from "../../../modules/task/subtask/subtask.access.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError, ForbiddenError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
    },
  },
}));

describe("SubtaskAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertParentTaskAccess", () => {
    it("should allow access if user is creator", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "p1",
        title: "Parent",
        depth: 0,
        workspaceId: "w1",
        projectId: "proj1",
        createdById: "u1",
        assignees: [],
      } as any);

      const result = await SubtaskAccess.assertParentTaskAccess("p1", "u1");
      expect(result.id).toBe("p1");
    });

    it("should throw NotFoundError if task not found or depth != 0", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(SubtaskAccess.assertParentTaskAccess("p1", "u1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("assertCanCreateSubtask", () => {
    it("should allow if user is creator", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "p1",
        title: "Parent",
        depth: 0,
        workspaceId: "w1",
        projectId: "proj1",
        createdById: "u1",
        assignees: [],
      } as any);

      const result = await SubtaskAccess.assertCanCreateSubtask("p1", "u1");
      expect(result.id).toBe("p1");
    });

    it("should allow if user is assignee", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "p1",
        title: "Parent",
        depth: 0,
        workspaceId: "w1",
        projectId: "proj1",
        createdById: "u2",
        assignees: [{ userId: "u1" }],
      } as any);

      const result = await SubtaskAccess.assertCanCreateSubtask("p1", "u1");
      expect(result.id).toBe("p1");
    });

    it("should throw ForbiddenError if user is neither creator nor assignee", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "p1",
        title: "Parent",
        depth: 0,
        workspaceId: "w1",
        projectId: "proj1",
        createdById: "u2",
        assignees: [{ userId: "u3" }],
      } as any);

      await expect(SubtaskAccess.assertCanCreateSubtask("p1", "u1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("checkEditPermission", () => {
    it("should allow creator to edit", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        title: "Sub",
        depth: 1,
        createdById: "u1",
        parentId: "p1",
        workspaceId: "w1",
        project: {
          members: [],
          workspace: { members: [] },
        },
      } as any);

      const result = await SubtaskAccess.checkEditPermission("s1", "u1");
      expect(result.canEdit).toBe(true);
    });

    it("should allow project manager to edit", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        title: "Sub",
        depth: 1,
        createdById: "u2",
        parentId: "p1",
        workspaceId: "w1",
        project: {
          members: [{ userId: "u1", role: "MANAGER" }],
          workspace: { members: [] },
        },
      } as any);

      const result = await SubtaskAccess.checkEditPermission("s1", "u1");
      expect(result.canEdit).toBe(true);
    });

    it("should allow workspace admin to edit", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        title: "Sub",
        depth: 1,
        createdById: "u2",
        parentId: "p1",
        workspaceId: "w1",
        project: {
          members: [],
          workspace: { members: [{ userId: "u1", role: "ADMIN" }] },
        },
      } as any);

      const result = await SubtaskAccess.checkEditPermission("s1", "u1");
      expect(result.canEdit).toBe(true);
    });

    it("should deny if no permission", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        title: "Sub",
        depth: 1,
        createdById: "u2",
        parentId: "p1",
        workspaceId: "w1",
        project: {
          members: [{ userId: "u1", role: "MEMBER" }],
          workspace: { members: [{ userId: "u1", role: "MEMBER" }] },
        },
      } as any);

      const result = await SubtaskAccess.checkEditPermission("s1", "u1");
      expect(result.canEdit).toBe(false);
    });

    it("should return canEdit: false if subtask not found", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      const result = await SubtaskAccess.checkEditPermission("s1", "u1");
      expect(result.canEdit).toBe(false);
      expect(result.reason).toBe("Subtask not found");
    });
  });

  describe("assertDeletePermission", () => {
    it("should allow creator to delete", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        depth: 1,
        createdById: "u1",
      } as any);

      const result = await SubtaskAccess.assertDeletePermission("s1", "u1");
      expect(result.id).toBe("s1");
    });

    it("should allow workspace admin to delete", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        depth: 1,
        createdById: "u2",
        project: {
          workspace: {
            members: [{ userId: "u1", role: "ADMIN" }],
          },
        },
      } as any);

      const result = await SubtaskAccess.assertDeletePermission("s1", "u1");
      expect(result.id).toBe("s1");
    });

    it("should throw ForbiddenError if no permission", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(SubtaskAccess.assertDeletePermission("s1", "u1")).rejects.toThrow(ForbiddenError);
    });
  });
});
