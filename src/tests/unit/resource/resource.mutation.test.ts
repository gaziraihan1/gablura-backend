import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  createPopularResource, 
  updatePopularResource, 
  deletePopularResource,
  createProductUpdate,
  updateProductUpdate,
  deleteProductUpdate
} from "../../../modules/resource/resource.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { SlugService } from "../../../services/slug.service.js";

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    popularResource: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    productUpdate: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../../services/slug.service", () => ({
  SlugService: {
    generatePopularResourceSlug: vi.fn(),
    generateProductUpdateSlug: vi.fn(),
  },
}));

describe("Resource Mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPopularResource", () => {
    it("should generate a slug and create a resource", async () => {
      const data = { title: "Test Res", description: "Desc", url: "http://test.com" };
      (SlugService.generatePopularResourceSlug as any).mockResolvedValue("test-res");
      (prisma.popularResource.create as any).mockResolvedValue({ id: "r1", ...data, slug: "test-res" });

      const result = await createPopularResource(data as any, "u1");

      expect(SlugService.generatePopularResourceSlug).toHaveBeenCalledWith(data.title);
      expect(prisma.popularResource.create).toHaveBeenCalledWith({
        data: { ...data, slug: "test-res", createdById: "u1" },
      });
      expect(result.id).toBe("r1");
    });
  });

  describe("deletePopularResource", () => {
    it("should delete by slug", async () => {
      await deletePopularResource("test-res");
      expect(prisma.popularResource.delete).toHaveBeenCalledWith({ where: { slug: "test-res" } });
    });
  });

  describe("updatePopularResource", () => {
    it("should update a resource by slug", async () => {
      const data = { title: "Updated Title", description: "Updated Desc" };
      const updated = { id: "r1", slug: "test-res", ...data };
      (prisma.popularResource.update as any).mockResolvedValue(updated);

      const result = await updatePopularResource("test-res", data as any);

      expect(prisma.popularResource.update).toHaveBeenCalledWith({
        where: { slug: "test-res" },
        data,
      });
      expect(result).toEqual(updated);
    });
  });

  describe("createProductUpdate", () => {
    it("should generate a slug and create a product update", async () => {
      const data = { title: "New Update", content: "..." };
      (SlugService.generateProductUpdateSlug as any).mockResolvedValue("new-update");
      (prisma.productUpdate.create as any).mockResolvedValue({ id: "pu1", ...data, slug: "new-update" });

      const result = await createProductUpdate(data as any, "u1");

      expect(SlugService.generateProductUpdateSlug).toHaveBeenCalledWith(data.title);
      expect(prisma.productUpdate.create).toHaveBeenCalledWith({
        data: { ...data, slug: "new-update", createdById: "u1" },
      });
      expect(result.id).toBe("pu1");
    });
  });

  describe("updateProductUpdate", () => {
    it("should update a product update by slug", async () => {
      const data = { title: "Updated Title", version: "2.0" };
      const updated = { id: "pu1", slug: "new-update", ...data };
      (prisma.productUpdate.update as any).mockResolvedValue(updated);

      const result = await updateProductUpdate("new-update", data as any);

      expect(prisma.productUpdate.update).toHaveBeenCalledWith({
        where: { slug: "new-update" },
        data,
      });
      expect(result).toEqual(updated);
    });
  });

  describe("deleteProductUpdate", () => {
    it("should delete a product update by slug", async () => {
      await deleteProductUpdate("new-update");
      expect(prisma.productUpdate.delete).toHaveBeenCalledWith({ where: { slug: "new-update" } });
    });
  });
});
