import { describe, it, expect } from "vitest";
import {
  createProjectSchema,
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberRoleSchema,
} from "../../../modules/project/project.validators.js";

describe("Project Validators", () => {
  describe("createProjectSchema", () => {
    it("should pass with valid minimal data", () => {
      const result = createProjectSchema.safeParse({
        name: "My Project",
        workspaceId: "ws1",
      });
      expect(result.success).toBe(true);
    });

    it("should pass with all optional fields", () => {
      const result = createProjectSchema.safeParse({
        name: "Full Project",
        description: "A description",
        color: "#667eea",
        icon: "rocket",
        status: "ACTIVE",
        priority: "HIGH",
        startDate: "2024-01-01",
        dueDate: "2024-12-31",
        workspaceId: "ws1",
      });
      expect(result.success).toBe(true);
    });

    it("should fail if name is empty", () => {
      const result = createProjectSchema.safeParse({
        name: "",
        workspaceId: "ws1",
      });
      expect(result.success).toBe(false);
    });

    it("should fail if name exceeds 100 characters", () => {
      const result = createProjectSchema.safeParse({
        name: "x".repeat(101),
        workspaceId: "ws1",
      });
      expect(result.success).toBe(false);
    });

    it("should fail if workspaceId is missing", () => {
      const result = createProjectSchema.safeParse({
        name: "Project",
      });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid color format", () => {
      const result = createProjectSchema.safeParse({
        name: "Project",
        workspaceId: "ws1",
        color: "red",
      });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid status", () => {
      const result = createProjectSchema.safeParse({
        name: "Project",
        workspaceId: "ws1",
        status: "INVALID",
      });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid priority", () => {
      const result = createProjectSchema.safeParse({
        name: "Project",
        workspaceId: "ws1",
        priority: "CRITICAL",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateProjectSchema", () => {
    it("should pass with partial data", () => {
      const result = updateProjectSchema.safeParse({ name: "Updated" });
      expect(result.success).toBe(true);
    });

    it("should pass with empty object (all optional)", () => {
      const result = updateProjectSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should fail with invalid color", () => {
      const result = updateProjectSchema.safeParse({ color: "abc" });
      expect(result.success).toBe(false);
    });
  });

  describe("addProjectMemberSchema", () => {
    it("should pass with valid data", () => {
      const result = addProjectMemberSchema.safeParse({
        userId: "u1",
        role: "COLLABORATOR",
      });
      expect(result.success).toBe(true);
    });

    it("should pass without role (uses default)", () => {
      const result = addProjectMemberSchema.safeParse({ userId: "u1" });
      expect(result.success).toBe(true);
    });

    it("should fail if userId is missing", () => {
      const result = addProjectMemberSchema.safeParse({ role: "MANAGER" });
      expect(result.success).toBe(false);
    });

    it("should fail with invalid role", () => {
      const result = addProjectMemberSchema.safeParse({
        userId: "u1",
        role: "OWNER",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateProjectMemberRoleSchema", () => {
    it("should pass with valid role", () => {
      const result = updateProjectMemberRoleSchema.safeParse({
        role: "MANAGER",
      });
      expect(result.success).toBe(true);
    });

    it("should fail if role is missing", () => {
      const result = updateProjectMemberRoleSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should fail with invalid role", () => {
      const result = updateProjectMemberRoleSchema.safeParse({
        role: "ADMIN",
      });
      expect(result.success).toBe(false);
    });
  });
});
