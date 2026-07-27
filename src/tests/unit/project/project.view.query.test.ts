import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectViewQuery } from "../../../modules/project/project.view.query.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectView: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

describe("ProjectViewQuery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("getByProject", () => {
    it("should return views created by user or shared", async () => {
      const mockViews = [
        { id: "v1", name: "My View", createdById: "u1", visibility: "PRIVATE" },
        { id: "v2", name: "Team View", createdById: "u2", visibility: "SHARED" },
      ];
      (prisma.projectView.findMany as any).mockResolvedValue(mockViews);
      const result = await ProjectViewQuery.getByProject("p1", "u1");
      expect(prisma.projectView.findMany).toHaveBeenCalledWith({
        where: {
          projectId: "p1",
          OR: [{ createdById: "u1" }, { visibility: "SHARED" }],
        },
        orderBy: { id: "asc" },
      });
      expect(result).toHaveLength(2);
    });

    it("should return empty array", async () => {
      (prisma.projectView.findMany as any).mockResolvedValue([]);
      const result = await ProjectViewQuery.getByProject("p1", "u1");
      expect(result).toEqual([]);
    });
  });

  describe("getById", () => {
    it("should return a view by id", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue({ id: "v1" });
      const result = await ProjectViewQuery.getById("v1");
      expect(result).toBeDefined();
    });

    it("should throw NotFoundError", async () => {
      (prisma.projectView.findUnique as any).mockResolvedValue(null);
      await expect(ProjectViewQuery.getById("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("getDefaultView", () => {
    it("should return default view", async () => {
      (prisma.projectView.findFirst as any).mockResolvedValue({ id: "v1", isDefault: true });
      const result = await ProjectViewQuery.getDefaultView("p1");
      expect(result).toBeDefined();
    });

    it("should return null if no default", async () => {
      (prisma.projectView.findFirst as any).mockResolvedValue(null);
      const result = await ProjectViewQuery.getDefaultView("p1");
      expect(result).toBeNull();
    });
  });
});
