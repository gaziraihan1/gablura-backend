import { describe, it, expect } from "vitest";
import { createMilestoneSchema, updateMilestoneSchema } from "../../../modules/project/project.milestone.validators.js";

describe("Milestone Validators", () => {
  describe("createMilestoneSchema", () => {
    it("should pass with valid minimal data", () => {
      const result = createMilestoneSchema.safeParse({ title: "Launch MVP", projectId: "proj1" });
      expect(result.success).toBe(true);
    });

    it("should pass with all optional fields", () => {
      const result = createMilestoneSchema.safeParse({
        title: "Beta Release",
        description: "Internal beta testing phase",
        dueDate: "2024-06-01T00:00:00Z",
        color: "#10b981",
        icon: "rocket",
        projectId: "proj1",
        dependsOnId: "milestone2",
      });
      expect(result.success).toBe(true);
    });

    it("should fail if title is empty", () => {
      const result = createMilestoneSchema.safeParse({ title: "", projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if title exceeds 200 characters", () => {
      const result = createMilestoneSchema.safeParse({ title: "x".repeat(201), projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if projectId is missing", () => {
      const result = createMilestoneSchema.safeParse({ title: "Milestone" });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid color", () => {
      const result = createMilestoneSchema.safeParse({ title: "M1", projectId: "p1", color: "bad" });
      expect(result.success).toBe(false);
    });

    it("should reject description over 2000 chars", () => {
      const result = createMilestoneSchema.safeParse({ title: "M1", projectId: "p1", description: "x".repeat(2001) });
      expect(result.success).toBe(false);
    });
  });

  describe("updateMilestoneSchema", () => {
    it("should pass with empty object", () => {
      const result = updateMilestoneSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should pass with all statuses", () => {
      for (const status of ["ON_TRACK", "AT_RISK", "DELAYED", "COMPLETED"]) {
        const result = updateMilestoneSchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid status", () => {
      const result = updateMilestoneSchema.safeParse({ status: "CANCELLED" });
      expect(result.success).toBe(false);
    });

    it("should validate progress between 0 and 100", () => {
      expect(updateMilestoneSchema.safeParse({ progress: 50 }).success).toBe(true);
      expect(updateMilestoneSchema.safeParse({ progress: -1 }).success).toBe(false);
      expect(updateMilestoneSchema.safeParse({ progress: 101 }).success).toBe(false);
    });

    it("should allow clearing dependsOnId with null", () => {
      const result = updateMilestoneSchema.safeParse({ dependsOnId: null });
      expect(result.success).toBe(true);
    });
  });
});
