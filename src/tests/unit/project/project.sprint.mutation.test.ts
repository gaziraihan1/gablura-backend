import { describe, it, expect, vi, beforeEach } from "vitest";
import { SprintMutation } from "../../../modules/project/project.sprint.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { BadRequestError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    sprint: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertProjectAdminAccess: vi.fn().mockResolvedValue({ id: "proj1" }),
    assertProjectNotArchived: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    ProjectCache: { invalidateProject: vi.fn().mockResolvedValue(undefined) },
  };
});

describe("SprintMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("create", () => {
    it("should create a sprint with valid data", async () => {
      const data = { name: "Sprint 1", goal: "MVP", startDate: new Date("2024-01-01"), endDate: new Date("2024-01-14"), projectId: "proj1" };
      (prisma.sprint.create as any).mockResolvedValue({ id: "s1", ...data });
      const result = await SprintMutation.create(data, "u1");
      expect(prisma.sprint.create).toHaveBeenCalledWith({ data });
      expect(result.id).toBe("s1");
    });

    it("should throw BadRequestError if endDate <= startDate", async () => {
      const data = { name: "Bad Sprint", startDate: new Date("2024-01-14"), endDate: new Date("2024-01-01"), projectId: "proj1" };
      await expect(SprintMutation.create(data, "u1")).rejects.toThrow(BadRequestError);
      expect(prisma.sprint.create).not.toHaveBeenCalled();
    });

    it("should assert project admin access", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      const data = { name: "S1", startDate: new Date("2024-01-01"), endDate: new Date("2024-01-14"), projectId: "proj1" };
      (prisma.sprint.create as any).mockResolvedValue({ id: "s1" });
      await SprintMutation.create(data, "u1");
      expect(ProjectAccess.assertProjectAdminAccess).toHaveBeenCalledWith("u1", "proj1");
    });

    it("should assert project not archived", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      const data = { name: "S1", startDate: new Date("2024-01-01"), endDate: new Date("2024-01-14"), projectId: "proj1" };
      (prisma.sprint.create as any).mockResolvedValue({ id: "s1" });
      await SprintMutation.create(data, "u1");
      expect(ProjectAccess.assertProjectNotArchived).toHaveBeenCalledWith("proj1");
    });
  });

  describe("update", () => {
    it("should update a sprint with valid data", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue({ id: "s1", projectId: "proj1" });
      (prisma.sprint.update as any).mockResolvedValue({ id: "s1", name: "Updated" });
      const result = await SprintMutation.update("s1", { name: "Updated" }, "u1");
      expect(prisma.sprint.update).toHaveBeenCalled();
      expect(result.name).toBe("Updated");
    });

    it("should throw NotFoundError if sprint not found", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue(null);
      await expect(SprintMutation.update("nonexistent", { name: "X" }, "u1")).rejects.toThrow(NotFoundError);
    });

    it("should auto-set completedAt when status is COMPLETED", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue({ id: "s1", projectId: "proj1" });
      (prisma.sprint.update as any).mockResolvedValue({ id: "s1", status: "COMPLETED", completedAt: new Date() });
      await SprintMutation.update("s1", { status: "COMPLETED" as any }, "u1");
      const updateCall = (prisma.sprint.update as any).mock.calls[0][0];
      expect(updateCall.data.completedAt).toBeDefined();
    });
  });

  describe("delete", () => {
    it("should delete a sprint", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue({ id: "s1", projectId: "proj1" });
      await SprintMutation.delete("s1", "u1");
      expect(prisma.sprint.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
    });

    it("should throw NotFoundError if sprint not found", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue(null);
      await expect(SprintMutation.delete("nonexistent", "u1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("complete", () => {
    it("should complete sprint with retrospective and calculate velocity", async () => {
      const mockSprint = {
        id: "s1",
        projectId: "proj1",
        project: {
          tasks: [
            { status: "COMPLETED", estimatedHours: 8, actualHours: 7 },
            { status: "IN_PROGRESS", estimatedHours: 4, actualHours: null },
            { status: "COMPLETED", estimatedHours: 6, actualHours: 5 },
          ],
        },
      };
      (prisma.sprint.findUnique as any).mockResolvedValue(mockSprint);
      (prisma.sprint.update as any).mockResolvedValue({ id: "s1", status: "COMPLETED" });

      const result = await SprintMutation.complete("s1", "u1", "Great sprint!");
      const updateData = (prisma.sprint.update as any).mock.calls[0][0].data;
      expect(updateData.status).toBe("COMPLETED");
      expect(updateData.retrospective).toBe("Great sprint!");
      expect(updateData.totalPoints).toBe(18); // 8 + 4 + 6
      expect(updateData.completedPoints).toBe(14); // 8 + 6
      // velocity = sum(7/8 + 5/6) / 3 total tasks = 1.708 / 3 = 0.569 -> Math.round -> 0.57
      expect(updateData.velocity).toBeCloseTo(0.57, 1);
    });

    it("should complete sprint without retrospective", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue({
        id: "s1", projectId: "proj1",
        project: { tasks: [] },
      });
      (prisma.sprint.update as any).mockResolvedValue({ id: "s1", status: "COMPLETED" });
      await SprintMutation.complete("s1", "u1");
      expect(prisma.sprint.update).toHaveBeenCalled();
    });

    it("should handle empty task list gracefully", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue({
        id: "s1", projectId: "proj1",
        project: { tasks: [] },
      });
      (prisma.sprint.update as any).mockResolvedValue({ id: "s1", status: "COMPLETED" });
      const result = await SprintMutation.complete("s1", "u1");
      const updateData = (prisma.sprint.update as any).mock.calls[0][0].data;
      expect(updateData.totalPoints).toBe(0);
      expect(updateData.completedPoints).toBe(0);
      expect(updateData.velocity).toBeNull();
    });

    it("should throw NotFoundError if sprint not found", async () => {
      (prisma.sprint.findUnique as any).mockResolvedValue(null);
      await expect(SprintMutation.complete("nonexistent", "u1")).rejects.toThrow(NotFoundError);
    });
  });
});
