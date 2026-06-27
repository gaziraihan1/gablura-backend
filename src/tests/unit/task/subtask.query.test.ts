import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubtaskQuery } from "../../../modules/task/subtask/subtask.query.js";
import { prisma } from "../../../lib/prisma.js";
import { SubtaskAccess } from "../../../modules/task/subtask/subtask.access.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/task/subtask/subtask.access.js", () => ({
  SubtaskAccess: {
    assertParentTaskAccess: vi.fn(),
  },
}));

describe("SubtaskQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSubtasks", () => {
    it("should return subtasks for a parent task", async () => {
      vi.mocked(SubtaskAccess.assertParentTaskAccess).mockResolvedValue({} as any);
      vi.mocked(prisma.task.findMany).mockResolvedValue([
        { id: "s1", title: "Subtask 1", parentId: "p1", depth: 1 },
        { id: "s2", title: "Subtask 2", parentId: "p1", depth: 1 },
      ] as any);

      const result = await SubtaskQuery.getSubtasks("p1", "u1");
      expect(result).toHaveLength(2);
      expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { parentId: "p1", depth: 1 },
      }));
    });

    it("should throw error if parent access denied", async () => {
      vi.mocked(SubtaskAccess.assertParentTaskAccess).mockRejectedValue(new Error("Access Denied"));
      await expect(SubtaskQuery.getSubtasks("p1", "u1")).rejects.toThrow("Access Denied");
    });
  });

  describe("getSubtaskById", () => {
    it("should return subtask if it exists and user has access", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        id: "s1",
        title: "Subtask 1",
        parentId: "p1",
        depth: 1,
      } as any);
      vi.mocked(SubtaskAccess.assertParentTaskAccess).mockResolvedValue({} as any);

      const result = await SubtaskQuery.getSubtaskById("s1", "u1");
      expect(result.id).toBe("s1");
    });

    it("should throw error if subtask not found", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      await expect(SubtaskQuery.getSubtaskById("s1", "u1")).rejects.toThrow("NOT_FOUND: Subtask not found");
    });
  });

  describe("getSubtaskStats", () => {
    it("should return subtask stats", async () => {
      vi.mocked(SubtaskAccess.assertParentTaskAccess).mockResolvedValue({} as any);
      vi.mocked(prisma.task.count).mockResolvedValueOnce(10).mockResolvedValueOnce(4).mockResolvedValueOnce(3);

      const result = await SubtaskQuery.getSubtaskStats("p1", "u1");
      expect(result).toEqual({
        total: 10,
        completed: 4,
        inProgress: 3,
        todo: 3,
        completionRate: 40,
      });
    });
  });
});
