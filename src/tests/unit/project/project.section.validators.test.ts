import { describe, it, expect } from "vitest";
import { createSectionSchema, updateSectionSchema } from "../../../modules/project/project.section.validators.js";

describe("Section Validators", () => {
  describe("createSectionSchema", () => {
    it("should pass with valid minimal data", () => {
      const result = createSectionSchema.safeParse({ name: "Backend", projectId: "p1" });
      expect(result.success).toBe(true);
    });

    it("should pass with all optional fields", () => {
      const result = createSectionSchema.safeParse({
        name: "Frontend",
        description: "UI components",
        color: "#10b981",
        status: "ACTIVE",
        position: 1,
        projectId: "p1",
      });
      expect(result.success).toBe(true);
    });

    it("should fail if name is empty", () => {
      const result = createSectionSchema.safeParse({ name: "", projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if name exceeds 100 characters", () => {
      const result = createSectionSchema.safeParse({ name: "x".repeat(101), projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if projectId is missing", () => {
      const result = createSectionSchema.safeParse({ name: "Section" });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid color", () => {
      const result = createSectionSchema.safeParse({ name: "S1", projectId: "p1", color: "not-a-color" });
      expect(result.success).toBe(false);
    });

    it("should accept all valid statuses", () => {
      for (const status of ["PENDING", "ACTIVE", "COMPLETED"]) {
        const result = createSectionSchema.safeParse({ name: "S1", projectId: "p1", status });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid status", () => {
      const result = createSectionSchema.safeParse({ name: "S1", projectId: "p1", status: "DELETED" });
      expect(result.success).toBe(false);
    });

    it("should reject description over 500 chars", () => {
      const result = createSectionSchema.safeParse({ name: "S1", projectId: "p1", description: "x".repeat(501) });
      expect(result.success).toBe(false);
    });

    it("should validate position is non-negative", () => {
      const result = createSectionSchema.safeParse({ name: "S1", projectId: "p1", position: -1 });
      expect(result.success).toBe(false);
    });
  });

  describe("updateSectionSchema", () => {
    it("should pass with empty object", () => {
      const result = updateSectionSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should pass with partial data", () => {
      const result = updateSectionSchema.safeParse({ name: "Updated", color: "#ef4444" });
      expect(result.success).toBe(true);
    });

    it("should fail with invalid color", () => {
      const result = updateSectionSchema.safeParse({ color: "invalid" });
      expect(result.success).toBe(false);
    });
  });
});
