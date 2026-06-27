import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubtaskMutation } from "../../../modules/task/subtask/subtask.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { SubtaskAccess } from "../../../modules/task/subtask/subtask.access.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    task: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/task/subtask/subtask.access.js", () => ({
  SubtaskAccess: {
    assertCanCreateSubtask: vi.fn(),
    assertDeletePermission: vi.fn(),
    checkEditPermission: vi.fn(),
  },
}));

describe("SubtaskMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createSubtask", () => {
    const validData = {
      title: "Subtask 1",
      parentId: "p1",
      createdById: "u1",
      assigneeIds: ["u2"],
    };

    it("should create a subtask successfully", async () => {
      vi.mocked(SubtaskAccess.assertCanCreateSubtask).mockResolvedValue({
        id: "p1",
        workspaceId: "w1",
        projectId: "proj1",
        depth: 0,
      } as any);

      vi.mocked(prisma.task.create).mockResolvedValue({
        id: "s1",
        title: "Subtask 1",
        workspace: { slug: "ws-slug" },
      } as any);

      const result = await SubtaskMutation.createSubtask(validData as any);
      expect(result.id).toBe("s1");
      expect(prisma.task.create).toHaveBeenCalled();
    });

    it("should throw BadRequestError if title is missing", async () => {
      await expect(SubtaskMutation.createSubtask({ ...validData, title: "" } as any)).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if parent is already a subtask", async () => {
      vi.mocked(SubtaskAccess.assertCanCreateSubtask).mockResolvedValue({
        id: "p1",
        depth: 1,
      } as any);

      await expect(SubtaskMutation.createSubtask(validData as any)).rejects.toThrow(BadRequestError);
    });
  });

  describe("updateSubtask", () => {
    const userId = "u1";
    const subtaskId = "s1";
    const updateData = { title: "Updated Title" };

    it("should update subtask if permitted", async () => {
      vi.mocked(SubtaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        subtask: { id: subtaskId },
      });
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: subtaskId,
        status: "TODO",
        parentId: "p1",
        workspaceId: "w1",
      } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({
        id: subtaskId,
        title: "Updated Title",
      } as any);

      const result = await SubtaskMutation.updateSubtask(subtaskId, userId, updateData as any);
      expect(result.title).toBe("Updated Title");
      expect(prisma.task.update).toHaveBeenCalled();
    });

    it("should throw ForbiddenError if not permitted", async () => {
      vi.mocked(SubtaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: false,
        reason: "No permission",
      });

      await expect(SubtaskMutation.updateSubtask(subtaskId, userId, updateData as any)).rejects.toThrow(ForbiddenError);
    });

    it("should throw NotFoundError if subtask not found", async () => {
      vi.mocked(SubtaskAccess.checkEditPermission).mockResolvedValue({
        canEdit: true,
        subtask: { id: subtaskId },
      });
      vi.mocked(prisma.task.findUnique).mockResolvedValue(null);

      await expect(SubtaskMutation.updateSubtask(subtaskId, userId, updateData as any)).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateSubtaskStatus", () => {
    const userId = "u1";
    const subtaskId = "s1";
    const status = "COMPLETED";

    it("should update status successfully", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: subtaskId,
        status: "TODO",
        parentId: "p1",
        workspaceId: "w1",
        title: "Subtask",
      } as any);
      vi.mocked(prisma.task.update).mockResolvedValue({
        id: subtaskId,
        status: "COMPLETED",
      } as any);

      const result = await SubtaskMutation.updateSubtaskStatus(subtaskId, userId, status);
      expect(result.status).toBe("COMPLETED");
      expect(prisma.task.update).toHaveBeenCalled();
    });

    it("should throw ForbiddenError if no permission", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(SubtaskMutation.updateSubtaskStatus(subtaskId, userId, status)).rejects.toThrow(ForbiddenError);
    });

    it("should throw BadRequestError if status is missing", async () => {
      await expect(SubtaskMutation.updateSubtaskStatus(subtaskId, userId, "")).rejects.toThrow(BadRequestError);
    });
  });

  describe("deleteSubtask", () => {
    const userId = "u1";
    const subtaskId = "s1";

    it("should delete subtask successfully", async () => {
      vi.mocked(SubtaskAccess.assertDeletePermission).mockResolvedValue({
        id: subtaskId,
      } as any);
      vi.mocked(prisma.task.findUnique).mockResolvedValue({
        id: subtaskId,
        title: "Subtask",
        parentId: "p1",
        workspaceId: "w1",
      } as any);
      vi.mocked(prisma.task.delete).mockResolvedValue({ id: subtaskId } as any);

      const result = await SubtaskMutation.deleteSubtask(subtaskId, userId);
      expect(result.success).toBe(true);
      expect(prisma.task.delete).toHaveBeenCalled();
    });
  });
});
;
