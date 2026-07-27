import { describe, it, expect } from "vitest";
import { createProjectViewSchema, updateProjectViewSchema } from "../../../modules/project/project.view.validators.js";

describe("ProjectView Validators", () => {
  describe("createProjectViewSchema", () => {
    it("should pass with valid minimal data", () => {
      const result = createProjectViewSchema.safeParse({ name: "My Kanban", projectId: "p1" });
      expect(result.success).toBe(true);
    });

    it("should pass with all fields", () => {
      const result = createProjectViewSchema.safeParse({
        name: "Sprint Board",
        description: "Current sprint view",
        type: "KANBAN",
        filters: { status: ["TODO", "IN_PROGRESS"] },
        sort: { priority: "desc" },
        config: { showCompletedTasks: false },
        isDefault: true,
        visibility: "SHARED",
        projectId: "p1",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid view type", () => {
      const result = createProjectViewSchema.safeParse({ name: "V1", projectId: "p1", type: "MAP" });
      expect(result.success).toBe(false);
    });

    it("should accept all valid types", () => {
      for (const type of ["KANBAN", "LIST", "CALENDAR", "TIMELINE"]) {
        const result = createProjectViewSchema.safeParse({ name: "V1", projectId: "p1", type });
        expect(result.success).toBe(true);
      }
    });

    it("should accept PRIVATE and SHARED visibility", () => {
      expect(createProjectViewSchema.safeParse({ name: "V1", projectId: "p1", visibility: "PRIVATE" }).success).toBe(true);
      expect(createProjectViewSchema.safeParse({ name: "V1", projectId: "p1", visibility: "SHARED" }).success).toBe(true);
    });

    it("should reject invalid visibility", () => {
      const result = createProjectViewSchema.safeParse({ name: "V1", projectId: "p1", visibility: "PUBLIC" });
      expect(result.success).toBe(false);
    });

    it("should fail if name is empty", () => {
      const result = createProjectViewSchema.safeParse({ name: "", projectId: "p1" });
      expect(result.success).toBe(false);
    });

    it("should fail if projectId is missing", () => {
      const result = createProjectViewSchema.safeParse({ name: "View" });
      expect(result.success).toBe(false);
    });
  });

  describe("updateProjectViewSchema", () => {
    it("should pass with empty object", () => {
      const result = updateProjectViewSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should pass with partial data", () => {
      const result = updateProjectViewSchema.safeParse({ name: "Updated", isDefault: true });
      expect(result.success).toBe(true);
    });
  });
});
