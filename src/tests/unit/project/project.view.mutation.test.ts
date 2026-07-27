import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectViewMutation } from "../../../modules/project/project.view.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectView: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertProjectAdminAccess: vi.fn().mockResolvedValue({ id: "p1" }),
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

describe("ProjectViewMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("create", () => {
    it("should create a view", async () => {
      (prisma.projectView.count as any).mockResolvedValue(0);
      (prisma.projectView.create as any).mockResolvedValue({ id: "v1", name: "My View" });
      const result = await ProjectViewMutation.create(
        { name: "My View", projectId: "p1", createdById: "u1" },
        "u1",
      );
      expect(prisma.projectView.create).toHaveBeenCalled();
      expect(result.id).toBe("v1");
    });

    it("should set first view as default", async () => {
      (prisma.projectView.count as any).mockResolvedValue(0);
      (prisma.projectView.create as any).mockResolvedValue({ id: "v1", isDefault: true });
      const result = await ProjectViewMutation.create(
        { name: "First View", projectId: "p1", createdById: "u1" },
        "u1",
      );
      const createData = (prisma.projectView.create as any).mock.calls[0][0].data;
      expect(createData.isDefault).toBe(true);
    });

    it("should not force default for subsequent views", async () => {
      (prisma.projectView.count as any).mockResolvedValue(2);
      (prisma.projectView.create as any).mockResolvedValue({ id: "v3", isDefault: false });
      await ProjectViewMutation.create(
        { name: "Third View", projectId: "p1", createdById: "u1" },
        "u1",
      );
      const createData = (prisma.projectView.create as any).mock.calls[0][0].data;
      expect(createData.isDefault).toBe(false);
    });

    it("should unset other defaults when setting isDefault", async () => {
      (prisma.projectView.count as any).mockResolvedValue(3);
      (prisma.projectView.updateMany as any).mockResolvedValue({ count: 3 });
      (prisma.projectView.create as any).mockResolvedValue({ id: "v4", isDefault: true });
      await ProjectViewMutation.create(
        { name: "New Default", projectId: "p1", createdById: "u1", isDefault: true },
        "u1",
      );
      expect(prisma.projectView.updateMany).toHaveBeenCalledWith({
        where: { projectId: "p1" },
        data: { isDefault: false },
      });
    });
  });

  describe("update", () => {
    it("should update a view", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue({ id: "v1", projectId: "p1", createdById: "u1" });
      (prisma.projectView.update as any).mockResolvedValue({ id: "v1", name: "Updated" });
      const result = await ProjectViewMutation.update("v1", { name: "Updated" }, "u1");
      expect(result.name).toBe("Updated");
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue(null);
      await expect(ProjectViewMutation.update("nonexistent", {}, "u1")).rejects.toThrow(NotFoundError);
    });

    it("should unset other defaults when setting isDefault", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue({ id: "v1", projectId: "p1", createdById: "u1" });
      (prisma.projectView.updateMany as any).mockResolvedValue({ count: 3 });
      (prisma.projectView.update as any).mockResolvedValue({ id: "v1", isDefault: true });
      await ProjectViewMutation.update("v1", { isDefault: true }, "u1");
      expect(prisma.projectView.updateMany).toHaveBeenCalledWith({
        where: { projectId: "p1", id: { not: "v1" } },
        data: { isDefault: false },
      });
    });
  });

  describe("delete", () => {
    it("should delete a view", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue({ id: "v1", projectId: "p1" });
      await ProjectViewMutation.delete("v1", "u1");
      expect(prisma.projectView.delete).toHaveBeenCalledWith({ where: { id: "v1" } });
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue(null);
      await expect(ProjectViewMutation.delete("nonexistent", "u1")).rejects.toThrow(NotFoundError);
    });
  });
});
