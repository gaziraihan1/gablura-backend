import { describe, it, expect } from "vitest";
import { createSprintSchema, updateSprintSchema } from "../../../modules/project/project.sprint.validators.js";

describe("Sprint Validators", () => {
  describe("createSprintSchema", () => {
    const validData = {
      name: "Sprint 1",
      startDate: "2024-01-01T00:00:00Z",
      endDate: "2024-01-14T00:00:00Z",
      projectId: "proj1",
    };

    it("should pass with valid minimal data", () => {
      const result = createSprintSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it("should pass with all optional fields", () => {
      const result = createSprintSchema.safeParse({
        ...validData,
        goal: "Complete the MVP",
      });
      expect(result.success).toBe(true);
    });

    it("should fail if name is empty", () => {
      const result = createSprintSchema.safeParse({ ...validData, name: "" });
      expect(result.success).toBe(false);
    });

    it("should fail if name exceeds 200 characters", () => {
      const result = createSprintSchema.safeParse({ ...validData, name: "x".repeat(201) });
      expect(result.success).toBe(false);
    });

    it("should fail if startDate is missing", () => {
      const result = createSprintSchema.safeParse({ name: "S1", endDate: "2024-01-14", projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if endDate is missing", () => {
      const result = createSprintSchema.safeParse({ name: "S1", startDate: "2024-01-01", projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if projectId is missing", () => {
      const result = createSprintSchema.safeParse({ name: "S1", startDate: "2024-01-01", endDate: "2024-01-14" });
      expect(result.success).toBe(false);
    });

    it("should coerce string dates to Date objects", () => {
      const result = createSprintSchema.safeParse(validData);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.startDate).toBeInstanceOf(Date);
        expect(result.data.endDate).toBeInstanceOf(Date);
      }
    });

    it("should allow goal up to 1000 characters", () => {
      const result = createSprintSchema.safeParse({
        ...validData,
        goal: "x".repeat(1000),
      });
      expect(result.success).toBe(true);
    });

    it("should reject goal over 1000 characters", () => {
      const result = createSprintSchema.safeParse({
        ...validData,
        goal: "x".repeat(1001),
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateSprintSchema", () => {
    it("should pass with valid partial data", () => {
      const result = updateSprintSchema.safeParse({ name: "Updated Sprint" });
      expect(result.success).toBe(true);
    });

    it("should pass with empty object (all optional)", () => {
      const result = updateSprintSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should pass with all fields", () => {
      const result = updateSprintSchema.safeParse({
        name: "Sprint 2",
        goal: "Ship feature X",
        status: "ACTIVE",
        startDate: "2024-02-01T00:00:00Z",
        endDate: "2024-02-14T00:00:00Z",
        retrospective: "Went well, could improve communication",
        totalPoints: 40,
        completedPoints: 35,
        velocity: 35,
      });
      expect(result.success).toBe(true);
    });

    it("should accept all valid statuses", () => {
      const statuses = ["PLANNING", "ACTIVE", "COMPLETED", "CANCELLED"];
      for (const status of statuses) {
        const result = updateSprintSchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it("should reject invalid status", () => {
      const result = updateSprintSchema.safeParse({ status: "INVALID" });
      expect(result.success).toBe(false);
    });

    it("should validate totalPoints in range", () => {
      const result = updateSprintSchema.safeParse({ totalPoints: -1 });
      expect(result.success).toBe(false);
    });

    it("should validate completedPoints in range", () => {
      const result = updateSprintSchema.safeParse({ completedPoints: -1 });
      expect(result.success).toBe(false);
    });

    it("should validate velocity is positive", () => {
      const result = updateSprintSchema.safeParse({ velocity: -5 });
      expect(result.success).toBe(false);
    });

    it("should reject retrospective over 5000 characters", () => {
      const result = updateSprintSchema.safeParse({ retrospective: "x".repeat(5001) });
      expect(result.success).toBe(false);
    });
  });
});
