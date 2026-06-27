import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  findPopularResources,
  findPopularResourceBySlug,
  findPublicPopularResources,
  findPublicPopularResourceBySlug,
  findProductUpdates,
  findProductUpdateBySlug,
  findPublicProductUpdates,
  findPublicProductUpdateBySlug
} from "../../../modules/resource/resource.query.js";
import { prisma } from "../../../lib/prisma.js";
import { ResourceStatus } from "../../../modules/resource/resource.types.js";

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    popularResource: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    productUpdate: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe("Resource Query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findPopularResources", () => {
    it("should return paginated results", async () => {
      const mockItems = [{ id: "r1", title: "Res" }];
      (prisma.popularResource.findMany as any).mockResolvedValue(mockItems);
      (prisma.popularResource.count as any).mockResolvedValue(1);

      const result = await findPopularResources({ page: 1, limit: 10 });

      expect(prisma.popularResource.findMany).toHaveBeenCalled();
      expect(result.items).toEqual(mockItems);
      expect(result.total).toBe(1);
    });

    it("should filter by status", async () => {
      const mockItems = [{ id: "r1", title: "Res" }];
      (prisma.popularResource.findMany as any).mockResolvedValue(mockItems);
      (prisma.popularResource.count as any).mockResolvedValue(1);

      await findPopularResources({ page: 1, limit: 10, status: ResourceStatus.PUBLIC });

      expect(prisma.popularResource.findMany).toHaveBeenCalledWith({
        where: { status: ResourceStatus.PUBLIC },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      });
    });

    it("should filter by category", async () => {
      const mockItems = [{ id: "r1", title: "Res" }];
      (prisma.popularResource.findMany as any).mockResolvedValue(mockItems);
      (prisma.popularResource.count as any).mockResolvedValue(1);

      await findPopularResources({ page: 1, limit: 10, category: "GENERAL" });

      expect(prisma.popularResource.findMany).toHaveBeenCalledWith({
        where: { category: "GENERAL" },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      });
    });

    it("should calculate totalPages correctly", async () => {
      const mockItems = [{ id: "r1", title: "Res" }];
      (prisma.popularResource.findMany as any).mockResolvedValue(mockItems);
      (prisma.popularResource.count as any).mockResolvedValue(25);

      const result = await findPopularResources({ page: 1, limit: 10 });

      expect(result.totalPages).toBe(3);
    });

    it("should default totalPages to 1 when total is 0", async () => {
      (prisma.popularResource.findMany as any).mockResolvedValue([]);
      (prisma.popularResource.count as any).mockResolvedValue(0);

      const result = await findPopularResources({ page: 1, limit: 10 });

      expect(result.totalPages).toBe(1);
    });
  });

  describe("findPopularResourceBySlug", () => {
    it("should find a resource by slug", async () => {
      const mockResource = { id: "r1", slug: "test-res", title: "Test" };
      (prisma.popularResource.findUnique as any).mockResolvedValue(mockResource);

      const result = await findPopularResourceBySlug("test-res");

      expect(prisma.popularResource.findUnique).toHaveBeenCalledWith({
        where: { slug: "test-res" },
      });
      expect(result).toEqual(mockResource);
    });

    it("should return null if resource not found", async () => {
      (prisma.popularResource.findUnique as any).mockResolvedValue(null);

      const result = await findPopularResourceBySlug("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findPublicPopularResources", () => {
    it("should only return PUBLIC resources", async () => {
      const mockItems = [{ id: "r1", title: "Res" }];
      (prisma.popularResource.findMany as any).mockResolvedValue(mockItems);
      (prisma.popularResource.count as any).mockResolvedValue(1);

      await findPublicPopularResources({ page: 1, limit: 10, category: "GENERAL" });

      expect(prisma.popularResource.findMany).toHaveBeenCalledWith({
        where: { status: ResourceStatus.PUBLIC, category: "GENERAL" },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 10,
      });
    });
  });

  describe("findPublicPopularResourceBySlug", () => {
    it("should find a PUBLIC resource by slug", async () => {
      const mockResource = { id: "r1", slug: "test-res", title: "Test", status: ResourceStatus.PUBLIC };
      (prisma.popularResource.findFirst as any).mockResolvedValue(mockResource);

      const result = await findPublicPopularResourceBySlug("test-res");

      expect(prisma.popularResource.findFirst).toHaveBeenCalledWith({
        where: { slug: "test-res", status: ResourceStatus.PUBLIC },
      });
      expect(result).toEqual(mockResource);
    });

    it("should return null if resource is not PUBLIC", async () => {
      (prisma.popularResource.findFirst as any).mockResolvedValue(null);

      const result = await findPublicPopularResourceBySlug("draft-res");

      expect(result).toBeNull();
    });
  });

  describe("findProductUpdates", () => {
    it("should return paginated results", async () => {
      const mockItems = [{ id: "pu1", title: "Update" }];
      (prisma.productUpdate.findMany as any).mockResolvedValue(mockItems);
      (prisma.productUpdate.count as any).mockResolvedValue(1);

      const result = await findProductUpdates({ page: 1, limit: 10 });

      expect(prisma.productUpdate.findMany).toHaveBeenCalled();
      expect(result.items).toEqual(mockItems);
      expect(result.total).toBe(1);
    });

    it("should filter by status", async () => {
      const mockItems = [{ id: "pu1", title: "Update" }];
      (prisma.productUpdate.findMany as any).mockResolvedValue(mockItems);
      (prisma.productUpdate.count as any).mockResolvedValue(1);

      await findProductUpdates({ page: 1, limit: 10, status: ResourceStatus.PUBLIC });

      expect(prisma.productUpdate.findMany).toHaveBeenCalledWith({
        where: { status: ResourceStatus.PUBLIC },
        orderBy: { date: "desc" },
        skip: 0,
        take: 10,
      });
    });

    it("should order by date descending", async () => {
      const mockItems = [{ id: "pu1", title: "Update" }];
      (prisma.productUpdate.findMany as any).mockResolvedValue(mockItems);
      (prisma.productUpdate.count as any).mockResolvedValue(1);

      await findProductUpdates({ page: 1, limit: 10 });

      expect(prisma.productUpdate.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { date: "desc" },
        skip: 0,
        take: 10,
      });
    });
  });

  describe("findProductUpdateBySlug", () => {
    it("should find a product update by slug", async () => {
      const mockUpdate = { id: "pu1", slug: "new-update", title: "Update" };
      (prisma.productUpdate.findUnique as any).mockResolvedValue(mockUpdate);

      const result = await findProductUpdateBySlug("new-update");

      expect(prisma.productUpdate.findUnique).toHaveBeenCalledWith({
        where: { slug: "new-update" },
      });
      expect(result).toEqual(mockUpdate);
    });

    it("should return null if update not found", async () => {
      (prisma.productUpdate.findUnique as any).mockResolvedValue(null);

      const result = await findProductUpdateBySlug("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findPublicProductUpdates", () => {
    it("should only return PUBLIC product updates", async () => {
      const mockItems = [{ id: "pu1", title: "Update" }];
      (prisma.productUpdate.findMany as any).mockResolvedValue(mockItems);
      (prisma.productUpdate.count as any).mockResolvedValue(1);

      await findPublicProductUpdates({ page: 1, limit: 10 });

      expect(prisma.productUpdate.findMany).toHaveBeenCalledWith({
        where: { status: ResourceStatus.PUBLIC },
        orderBy: { date: "desc" },
        skip: 0,
        take: 10,
      });
    });
  });

  describe("findPublicProductUpdateBySlug", () => {
    it("should find a PUBLIC product update by slug", async () => {
      const mockUpdate = { id: "pu1", slug: "new-update", title: "Update", status: ResourceStatus.PUBLIC };
      (prisma.productUpdate.findFirst as any).mockResolvedValue(mockUpdate);

      const result = await findPublicProductUpdateBySlug("new-update");

      expect(prisma.productUpdate.findFirst).toHaveBeenCalledWith({
        where: { slug: "new-update", status: ResourceStatus.PUBLIC },
      });
      expect(result).toEqual(mockUpdate);
    });

    it("should return null if update is not PUBLIC", async () => {
      (prisma.productUpdate.findFirst as any).mockResolvedValue(null);

      const result = await findPublicProductUpdateBySlug("draft-update");

      expect(result).toBeNull();
    });
  });
});
