import { describe, it, expect, vi, beforeEach } from "vitest";
import { MilestoneMutation } from "../../../modules/project/project.milestone.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { BadRequestError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectMilestone: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
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

describe("MilestoneMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("create", () => {
    it("should create a milestone", async () => {
      const data = { title: "Launch", projectId: "proj1" };
      (prisma.projectMilestone.create as any).mockResolvedValue({ id: "m1", ...data });
      const result = await MilestoneMutation.create(data, "u1");
      expect(prisma.projectMilestone.create).toHaveBeenCalledWith({ data });
      expect(result.id).toBe("m1");
    });

    it("should validate dependency exists in same project", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "dep1", projectId: "proj1" });
      (prisma.projectMilestone.create as any).mockResolvedValue({ id: "m1" });
      await MilestoneMutation.create({ title: "Follow-up", projectId: "proj1", dependsOnId: "dep1" }, "u1");
      expect(prisma.projectMilestone.create).toHaveBeenCalled();
    });

    it("should throw BadRequestError if dependency not in project", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "dep1", projectId: "other-proj" });
      await expect(
        MilestoneMutation.create({ title: "Follow-up", projectId: "proj1", dependsOnId: "dep1" }, "u1"),
      ).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if dependency not found", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue(null);
      await expect(
        MilestoneMutation.create({ title: "Follow-up", projectId: "proj1", dependsOnId: "nonexistent" }, "u1"),
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe("update", () => {
    it("should update a milestone", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "m1", projectId: "proj1" });
      (prisma.projectMilestone.update as any).mockResolvedValue({ id: "m1", title: "Updated" });
      const result = await MilestoneMutation.update("m1", { title: "Updated" }, "u1");
      expect(result.title).toBe("Updated");
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue(null);
      await expect(MilestoneMutation.update("nonexistent", {}, "u1")).rejects.toThrow(NotFoundError);
    });

    it("should auto-set completed status when completed=true", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "m1", projectId: "proj1" });
      (prisma.projectMilestone.update as any).mockResolvedValue({ id: "m1" });
      await MilestoneMutation.update("m1", { completed: true }, "u1");
      const updateData = (prisma.projectMilestone.update as any).mock.calls[0][0].data;
      expect(updateData.status).toBe("COMPLETED");
      expect(updateData.progress).toBe(100);
      expect(updateData.completedAt).toBeDefined();
    });
  });

  describe("delete", () => {
    it("should delete a milestone", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "m1", projectId: "proj1" });
      (prisma.projectMilestone.findMany as any).mockResolvedValue([]);
      await MilestoneMutation.delete("m1", "u1");
      expect(prisma.projectMilestone.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    });

    it("should throw BadRequestError if other milestones depend on it", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "m1", projectId: "proj1" });
      (prisma.projectMilestone.findMany as any).mockResolvedValue([{ id: "m2", title: "Dependent" }]);
      await expect(MilestoneMutation.delete("m1", "u1")).rejects.toThrow(BadRequestError);
      expect(prisma.projectMilestone.delete).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue(null);
      await expect(MilestoneMutation.delete("nonexistent", "u1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateProgress", () => {
    it("should update milestone progress", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "m1", projectId: "proj1", status: "ON_TRACK" });
      (prisma.projectMilestone.update as any).mockResolvedValue({ id: "m1", progress: 75 });
      const result = await MilestoneMutation.updateProgress("m1", 75, "u1");
      expect((prisma.projectMilestone.update as any).mock.calls[0][0].data.progress).toBe(75);
    });

    it("should auto-complete when progress reaches 100", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue({ id: "m1", projectId: "proj1", status: "ON_TRACK" });
      (prisma.projectMilestone.update as any).mockResolvedValue({ id: "m1", progress: 100 });
      await MilestoneMutation.updateProgress("m1", 100, "u1");
      const updateData = (prisma.projectMilestone.update as any).mock.calls[0][0].data;
      expect(updateData.status).toBe("COMPLETED");
      expect(updateData.completed).toBe(true);
      expect(updateData.completedAt).toBeDefined();
    });

    it("should throw BadRequestError for invalid progress values", async () => {
      await expect(MilestoneMutation.updateProgress("m1", -1, "u1")).rejects.toThrow(BadRequestError);
      await expect(MilestoneMutation.updateProgress("m1", 101, "u1")).rejects.toThrow(BadRequestError);
    });

    it("should throw NotFoundError if milestone not found", async () => {
      (prisma.projectMilestone.findUnique as any).mockResolvedValue(null);
      await expect(MilestoneMutation.updateProgress("nonexistent", 50, "u1")).rejects.toThrow(NotFoundError);
    });
  });
});
