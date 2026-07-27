import { describe, it, expect, vi, beforeEach } from "vitest";
import { FavoriteMutation } from "../../../modules/project/project.favorite.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    projectFavorite: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    $transaction: vi.fn((updates: any[]) => Promise.all(updates)),
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertProjectAccess: vi.fn().mockResolvedValue({ id: "p1" }),
  },
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    ProjectCache: { invalidateProject: vi.fn().mockResolvedValue(undefined) },
  };
});

describe("FavoriteMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe("add", () => {
    it("should add a favorite", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      (prisma.projectFavorite.aggregate as any).mockResolvedValue({ _max: { sortOrder: 2 } });
      (prisma.projectFavorite.create as any).mockResolvedValue({ id: "fav1", projectId: "p1", userId: "u1" });
      const result = await FavoriteMutation.add({ projectId: "p1", userId: "u1" });
      expect(prisma.projectFavorite.create).toHaveBeenCalled();
      expect(result.id).toBe("fav1");
    });

    it("should not create duplicate if already favorited", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue({ id: "existing", projectId: "p1", userId: "u1" });
      const result = await FavoriteMutation.add({ projectId: "p1", userId: "u1" });
      expect(prisma.projectFavorite.create).not.toHaveBeenCalled();
      expect(result.id).toBe("existing");
    });

    it("should set sortOrder after existing max", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      (prisma.projectFavorite.aggregate as any).mockResolvedValue({ _max: { sortOrder: 5 } });
      (prisma.projectFavorite.create as any).mockResolvedValue({ id: "fav1" });
      await FavoriteMutation.add({ projectId: "p1", userId: "u1" });
      const createData = (prisma.projectFavorite.create as any).mock.calls[0][0].data;
      expect(createData.sortOrder).toBe(6);
    });

    it("should handle empty max sortOrder", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      (prisma.projectFavorite.aggregate as any).mockResolvedValue({ _max: { sortOrder: null } });
      (prisma.projectFavorite.create as any).mockResolvedValue({ id: "fav1" });
      await FavoriteMutation.add({ projectId: "p1", userId: "u1" });
      const createData = (prisma.projectFavorite.create as any).mock.calls[0][0].data;
      expect(createData.sortOrder).toBe(0);
    });
  });

  describe("remove", () => {
    it("should remove a favorite", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue({ id: "fav1" });
      await FavoriteMutation.remove("p1", "u1");
      expect(prisma.projectFavorite.delete).toHaveBeenCalled();
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      await expect(FavoriteMutation.remove("p1", "u1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("toggle", () => {
    it("should return favorited=true when creating", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      (prisma.projectFavorite.aggregate as any).mockResolvedValue({ _max: { sortOrder: null } });
      (prisma.projectFavorite.create as any).mockResolvedValue({ id: "fav1" });
      const result = await FavoriteMutation.toggle("p1", "u1");
      expect(result).toEqual({ favorited: true });
    });

    it("should return favorited=false when removing", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue({ id: "fav1" });
      const result = await FavoriteMutation.toggle("p1", "u1");
      expect(result).toEqual({ favorited: false });
    });
  });

  describe("update", () => {
    it("should update favorite metadata", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue({ id: "fav1" });
      (prisma.projectFavorite.update as any).mockResolvedValue({ id: "fav1", group: "Active" });
      const result = await FavoriteMutation.update("p1", "u1", { group: "Active" });
      expect(result.group).toBe("Active");
    });

    it("should throw NotFoundError if not found", async () => {
      (prisma.projectFavorite.findUnique as any).mockResolvedValue(null);
      await expect(FavoriteMutation.update("p1", "u1", { group: "X" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("reorder", () => {
    it("should reorder favorites after verifying user ownership", async () => {
      (prisma.projectFavorite.findMany as any).mockResolvedValue([
        { id: "fav1" }, { id: "fav2" }, { id: "fav3" },
      ]);
      (prisma.projectFavorite.update as any).mockResolvedValue({});
      await FavoriteMutation.reorder("u1", ["fav1", "fav2", "fav3"]);
      expect(prisma.projectFavorite.findMany).toHaveBeenCalledWith({
        where: { userId: "u1", id: { in: ["fav1", "fav2", "fav3"] } },
        select: { id: true },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.projectFavorite.update).toHaveBeenCalledTimes(3);
      expect(prisma.projectFavorite.update).toHaveBeenNthCalledWith(1, { where: { id: "fav1" }, data: { sortOrder: 0 } });
      expect(prisma.projectFavorite.update).toHaveBeenNthCalledWith(2, { where: { id: "fav2" }, data: { sortOrder: 1 } });
      expect(prisma.projectFavorite.update).toHaveBeenNthCalledWith(3, { where: { id: "fav3" }, data: { sortOrder: 2 } });
    });

    it("should throw NotFoundError if some favorites don't belong to user", async () => {
      (prisma.projectFavorite.findMany as any).mockResolvedValue([
        { id: "fav1" }, { id: "fav2" },
      ]);
      await expect(
        FavoriteMutation.reorder("u1", ["fav1", "fav2", "fav3"]),
      ).rejects.toThrow(NotFoundError);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
