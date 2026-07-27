import { describe, it, expect, vi, beforeEach } from "vitest";
import { FavoriteQuery } from "../../../modules/project/project.favorite.query.js";
import { prisma } from "../../../lib/prisma.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectFavorite: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

describe("FavoriteQuery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("getByUser", () => {
    it("should return grouped and ungrouped favorites", async () => {
      const mockFavorites = [
        { id: "f1", projectId: "p1", group: "Active", sortOrder: 0, note: null, createdAt: new Date(),
          project: { id: "p1", name: "Project A", slug: "proj-a", color: "#667eea", status: "ACTIVE", workspace: { slug: "ws1" } } },
        { id: "f2", projectId: "p2", group: "Active", sortOrder: 1, note: null, createdAt: new Date(),
          project: { id: "p2", name: "Project B", slug: "proj-b", color: "#10b981", status: "ACTIVE", workspace: { slug: "ws1" } } },
        { id: "f3", projectId: "p3", group: null, sortOrder: 2, note: null, createdAt: new Date(),
          project: { id: "p3", name: "Project C", slug: "proj-c", color: null, status: "ACTIVE", workspace: { slug: "ws2" } } },
      ];
      (prisma.projectFavorite.findMany as any).mockResolvedValue(mockFavorites);
      const result = await FavoriteQuery.getByUser("u1");
      expect(result.grouped).toHaveLength(1);
      expect(result.grouped[0].group).toBe("Active");
      expect(result.grouped[0].favorites).toHaveLength(2);
      expect(result.ungrouped).toHaveLength(1);
      expect(result.ungrouped[0].project.name).toBe("Project C");
    });

    it("should handle empty favorites", async () => {
      (prisma.projectFavorite.findMany as any).mockResolvedValue([]);
      const result = await FavoriteQuery.getByUser("u1");
      expect(result.grouped).toEqual([]);
      expect(result.ungrouped).toEqual([]);
    });

    it("should handle multiple groups", async () => {
      const mockFavorites = [
        { id: "f1", projectId: "p1", group: "Work", sortOrder: 0, note: null, createdAt: new Date(),
          project: { id: "p1", name: "P1", slug: "p1", color: null, status: "ACTIVE", workspace: { slug: "ws" } } },
        { id: "f2", projectId: "p2", group: "Personal", sortOrder: 0, note: null, createdAt: new Date(),
          project: { id: "p2", name: "P2", slug: "p2", color: null, status: "ACTIVE", workspace: { slug: "ws" } } },
        { id: "f3", projectId: "p3", group: "Work", sortOrder: 1, note: null, createdAt: new Date(),
          project: { id: "p3", name: "P3", slug: "p3", color: null, status: "ACTIVE", workspace: { slug: "ws" } } },
      ];
      (prisma.projectFavorite.findMany as any).mockResolvedValue(mockFavorites);
      const result = await FavoriteQuery.getByUser("u1");
      expect(result.grouped).toHaveLength(2);
      expect(result.ungrouped).toEqual([]);
    });

    it("should order favorites by sortOrder then createdAt", async () => {
      (prisma.projectFavorite.findMany as any).mockResolvedValue([]);
      await FavoriteQuery.getByUser("u1");
      expect(prisma.projectFavorite.findMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        include: expect.any(Object),
      });
    });
  });

  describe("isFavorited", () => {
    it("should return true if favorited", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue({ id: "f1" });
      const result = await FavoriteQuery.isFavorited("p1", "u1");
      expect(result).toBe(true);
    });

    it("should return false if not favorited", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      const result = await FavoriteQuery.isFavorited("p1", "u1");
      expect(result).toBe(false);
    });
  });
});
