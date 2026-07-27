import { describe, it, expect } from "vitest";
import { createFavoriteSchema, updateFavoriteSchema } from "../../../modules/project/project.favorite.validators.js";

describe("Favorite Validators", () => {
  describe("createFavoriteSchema", () => {
    it("should pass with valid minimal data", () => {
      const result = createFavoriteSchema.safeParse({ projectId: "p1" });
      expect(result.success).toBe(true);
    });

    it("should pass with all optional fields", () => {
      const result = createFavoriteSchema.safeParse({
        projectId: "p1",
        group: "Active",
        sortOrder: 1,
        note: "Important project",
      });
      expect(result.success).toBe(true);
    });

    it("should fail if projectId is missing", () => {
      const result = createFavoriteSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject group > 50 chars", () => {
      const result = createFavoriteSchema.safeParse({ projectId: "p1", group: "x".repeat(51) });
      expect(result.success).toBe(false);
    });

    it("should reject note > 200 chars", () => {
      const result = createFavoriteSchema.safeParse({ projectId: "p1", note: "x".repeat(201) });
      expect(result.success).toBe(false);
    });

    it("should validate sortOrder >= 0", () => {
      expect(createFavoriteSchema.safeParse({ projectId: "p1", sortOrder: 0 }).success).toBe(true);
      expect(createFavoriteSchema.safeParse({ projectId: "p1", sortOrder: -1 }).success).toBe(false);
    });
  });

  describe("updateFavoriteSchema", () => {
    it("should pass with empty object", () => {
      const result = updateFavoriteSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should allow clearing group with null", () => {
      const result = updateFavoriteSchema.safeParse({ group: null });
      expect(result.success).toBe(true);
    });

    it("should allow clearing note with null", () => {
      const result = updateFavoriteSchema.safeParse({ note: null });
      expect(result.success).toBe(true);
    });

    it("should pass with valid updates", () => {
      const result = updateFavoriteSchema.safeParse({ group: "Archive", sortOrder: 5, note: "Completed" });
      expect(result.success).toBe(true);
    });
  });
});
