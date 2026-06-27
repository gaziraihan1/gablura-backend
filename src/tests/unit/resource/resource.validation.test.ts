import { describe, it, expect } from "vitest";
import {
  createPopularResourceSchema,
  updatePopularResourceSchema,
  createProductUpdateSchema,
  updateProductUpdateSchema,
  popularResourceListQuerySchema,
  productUpdateListQuerySchema,
  resourceSlugParamSchema,
} from "../../../modules/resource/resource.validation.js";

describe("Resource Validation", () => {
  describe("createPopularResourceSchema", () => {
    it("should validate valid data", () => {
      const data = {
        title: "Test Resource",
        description: "A test description",
        image: "https://example.com/image.jpg",
        category: "GENERAL",
      };
      const result = createPopularResourceSchema.parse(data);
      expect(result).toEqual({ ...data, status: "DRAFT" });
    });

    it("should require title", () => {
      const data = {
        description: "A test description",
        image: "https://example.com/image.jpg",
        category: "GENERAL",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should require description", () => {
      const data = {
        title: "Test Resource",
        image: "https://example.com/image.jpg",
        category: "GENERAL",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should require valid image URL", () => {
      const data = {
        title: "Test Resource",
        description: "A test description",
        image: "not-a-url",
        category: "GENERAL",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should require category", () => {
      const data = {
        title: "Test Resource",
        description: "A test description",
        image: "https://example.com/image.jpg",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should accept valid status", () => {
      const data = {
        title: "Test Resource",
        description: "A test description",
        image: "https://example.com/image.jpg",
        category: "GENERAL",
        status: "PUBLIC",
      };
      const result = createPopularResourceSchema.parse(data);
      expect(result.status).toBe("PUBLIC");
    });

    it("should reject invalid status", () => {
      const data = {
        title: "Test Resource",
        description: "A test description",
        image: "https://example.com/image.jpg",
        category: "GENERAL",
        status: "INVALID",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should trim whitespace", () => {
      const data = {
        title: "  Test Resource  ",
        description: "  A test description  ",
        image: "  https://example.com/image.jpg  ",
        category: "  GENERAL  ",
      };
      const result = createPopularResourceSchema.parse(data);
      expect(result.title).toBe("Test Resource");
      expect(result.description).toBe("A test description");
      expect(result.image).toBe("https://example.com/image.jpg");
      expect(result.category).toBe("GENERAL");
    });

    it("should enforce max length on title", () => {
      const data = {
        title: "a".repeat(201),
        description: "A test description",
        image: "https://example.com/image.jpg",
        category: "GENERAL",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should enforce max length on description", () => {
      const data = {
        title: "Test Resource",
        description: "a".repeat(5001),
        image: "https://example.com/image.jpg",
        category: "GENERAL",
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });

    it("should enforce max length on category", () => {
      const data = {
        title: "Test Resource",
        description: "A test description",
        image: "https://example.com/image.jpg",
        category: "a".repeat(101),
      };
      expect(() => createPopularResourceSchema.parse(data)).toThrow();
    });
  });

  describe("updatePopularResourceSchema", () => {
    it("should accept partial updates", () => {
      const data = { title: "Updated Title" };
      const result = updatePopularResourceSchema.parse(data);
      expect(result).toEqual({ ...data, status: "DRAFT" });
    });

    it("should validate title when provided", () => {
      const data = { title: "" };
      expect(() => updatePopularResourceSchema.parse(data)).toThrow();
    });

    it("should validate image URL when provided", () => {
      const data = { image: "not-a-url" };
      expect(() => updatePopularResourceSchema.parse(data)).toThrow();
    });

    it("should accept empty object", () => {
      const result = updatePopularResourceSchema.parse({});
      expect(result).toEqual({ status: "DRAFT" });
    });
  });

  describe("createProductUpdateSchema", () => {
    it("should validate valid data", () => {
      const data = {
        title: "New Update",
        date: "2024-01-01",
        description: "Update description",
        version: "1.0.0",
      };
      const result = createProductUpdateSchema.parse(data);
      expect(result).toEqual({ ...data, date: new Date("2024-01-01"), status: "DRAFT" });
    });

    it("should require title", () => {
      const data = {
        date: "2024-01-01",
        description: "Update description",
        version: "1.0.0",
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });

    it("should require valid date", () => {
      const data = {
        title: "New Update",
        date: "invalid-date",
        description: "Update description",
        version: "1.0.0",
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });

    it("should require description", () => {
      const data = {
        title: "New Update",
        date: "2024-01-01",
        version: "1.0.0",
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });

    it("should require version", () => {
      const data = {
        title: "New Update",
        date: "2024-01-01",
        description: "Update description",
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });

    it("should accept valid status", () => {
      const data = {
        title: "New Update",
        date: "2024-01-01",
        description: "Update description",
        version: "1.0.0",
        status: "PUBLIC",
      };
      const result = createProductUpdateSchema.parse(data);
      expect(result.status).toBe("PUBLIC");
    });

    it("should enforce max length on title", () => {
      const data = {
        title: "a".repeat(201),
        date: "2024-01-01",
        description: "Update description",
        version: "1.0.0",
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });

    it("should enforce max length on description", () => {
      const data = {
        title: "New Update",
        date: "2024-01-01",
        description: "a".repeat(5001),
        version: "1.0.0",
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });

    it("should enforce max length on version", () => {
      const data = {
        title: "New Update",
        date: "2024-01-01",
        description: "Update description",
        version: "a".repeat(51),
      };
      expect(() => createProductUpdateSchema.parse(data)).toThrow();
    });
  });

  describe("updateProductUpdateSchema", () => {
    it("should accept partial updates", () => {
      const data = { title: "Updated Title" };
      const result = updateProductUpdateSchema.parse(data);
      expect(result).toEqual({ ...data, status: "DRAFT" });
    });

    it("should validate title when provided", () => {
      const data = { title: "" };
      expect(() => updateProductUpdateSchema.parse(data)).toThrow();
    });

    it("should validate date when provided", () => {
      const data = { date: "invalid-date" };
      expect(() => updateProductUpdateSchema.parse(data)).toThrow();
    });

    it("should accept empty object", () => {
      const result = updateProductUpdateSchema.parse({});
      expect(result).toEqual({ status: "DRAFT" });
    });
  });

  describe("popularResourceListQuerySchema", () => {
    it("should validate valid query", () => {
      const data = { status: "PUBLIC", category: "GENERAL", page: "1", limit: "10" };
      const result = popularResourceListQuerySchema.parse(data);
      expect(result).toEqual({ status: "PUBLIC", category: "GENERAL", page: 1, limit: 10 });
    });

    it("should default page to 1", () => {
      const result = popularResourceListQuerySchema.parse({});
      expect(result.page).toBe(1);
    });

    it("should default limit to 8", () => {
      const result = popularResourceListQuerySchema.parse({});
      expect(result.limit).toBe(8);
    });

    it("should coerce page to number", () => {
      const result = popularResourceListQuerySchema.parse({ page: "5" });
      expect(result.page).toBe(5);
    });

    it("should coerce limit to number", () => {
      const result = popularResourceListQuerySchema.parse({ limit: "20" });
      expect(result.limit).toBe(20);
    });

    it("should reject negative page", () => {
      expect(() => popularResourceListQuerySchema.parse({ page: "-1" })).toThrow();
    });

    it("should reject limit over 100", () => {
      expect(() => popularResourceListQuerySchema.parse({ limit: "101" })).toThrow();
    });

    it("should accept valid status", () => {
      const result = popularResourceListQuerySchema.parse({ status: "DRAFT" });
      expect(result.status).toBe("DRAFT");
    });

    it("should reject invalid status", () => {
      expect(() => popularResourceListQuerySchema.parse({ status: "INVALID" })).toThrow();
    });
  });

  describe("productUpdateListQuerySchema", () => {
    it("should validate valid query", () => {
      const data = { status: "PUBLIC", page: "1", limit: "20" };
      const result = productUpdateListQuerySchema.parse(data);
      expect(result).toEqual({ status: "PUBLIC", page: 1, limit: 20 });
    });

    it("should default page to 1", () => {
      const result = productUpdateListQuerySchema.parse({});
      expect(result.page).toBe(1);
    });

    it("should default limit to 20", () => {
      const result = productUpdateListQuerySchema.parse({});
      expect(result.limit).toBe(20);
    });

    it("should coerce page to number", () => {
      const result = productUpdateListQuerySchema.parse({ page: "5" });
      expect(result.page).toBe(5);
    });

    it("should coerce limit to number", () => {
      const result = productUpdateListQuerySchema.parse({ limit: "30" });
      expect(result.limit).toBe(30);
    });

    it("should reject negative page", () => {
      expect(() => productUpdateListQuerySchema.parse({ page: "-1" })).toThrow();
    });

    it("should reject limit over 100", () => {
      expect(() => productUpdateListQuerySchema.parse({ limit: "101" })).toThrow();
    });
  });

  describe("resourceSlugParamSchema", () => {
    it("should validate valid slug", () => {
      const result = resourceSlugParamSchema.parse({ slug: "test-slug" });
      expect(result).toEqual({ slug: "test-slug" });
    });

    it("should require slug", () => {
      expect(() => resourceSlugParamSchema.parse({})).toThrow();
    });

    it("should reject empty slug", () => {
      expect(() => resourceSlugParamSchema.parse({ slug: "" })).toThrow();
    });

    it("should reject whitespace-only slug", () => {
      expect(() => resourceSlugParamSchema.parse({ slug: "   " })).toThrow();
    });

    it("should trim whitespace", () => {
      const result = resourceSlugParamSchema.parse({ slug: "  test-slug  " });
      expect(result.slug).toBe("test-slug");
    });
  });
});
