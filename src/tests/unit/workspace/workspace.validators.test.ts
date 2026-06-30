import { describe, it, expect } from "vitest";
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  inviteMemberSchema,
} from "../../../modules/workspace/workspace.validators.js";

describe("createWorkspaceSchema", () => {
  it("accepts a valid minimal payload", () => {
    const result = createWorkspaceSchema.safeParse({ name: "My Workspace" });
    expect(result.success).toBe(true);
  });

  it("accepts a valid full payload", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Full WS",
      description: "A workspace",
      color: "#FF5733",
      logo: "https://example.com/logo.png",
      isPublic: true,
      plan: "PRO",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = createWorkspaceSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 100 characters", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid color format", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Test",
      color: "red",
    });
    expect(result.success).toBe(false);
  });

  it("accepts lowercase hex color", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Test",
      color: "#ff5733",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid logo URL", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Test",
      logo: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid plan value", () => {
    const result = createWorkspaceSchema.safeParse({
      name: "Test",
      plan: "ULTRA",
    });
    expect(result.success).toBe(false);
  });

  it("accepts all valid plan values", () => {
    for (const plan of ["FREE", "PRO", "BUSINESS", "ENTERPRISE"]) {
      const result = createWorkspaceSchema.safeParse({ name: "Test", plan });
      expect(result.success).toBe(true);
    }
  });

  it("defaults optional fields when not provided", () => {
    const result = createWorkspaceSchema.safeParse({ name: "Test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.color).toBeUndefined();
      expect(result.data.isPublic).toBeUndefined();
    }
  });
});

describe("updateWorkspaceSchema", () => {
  it("accepts empty object (partial update)", () => {
    const result = updateWorkspaceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts single field update", () => {
    const result = updateWorkspaceSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("accepts allowInvites boolean", () => {
    const result = updateWorkspaceSchema.safeParse({ allowInvites: false });
    expect(result.success).toBe(true);
  });

  it("rejects name longer than 100 characters", () => {
    const result = updateWorkspaceSchema.safeParse({
      name: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid color", () => {
    const result = updateWorkspaceSchema.safeParse({
      name: "Test",
      color: "#GGGGGG",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid logo URL", () => {
    const result = updateWorkspaceSchema.safeParse({
      logo: "bad-url",
    });
    expect(result.success).toBe(false);
  });
});

describe("inviteMemberSchema", () => {
  it("accepts valid invitation", () => {
    const result = inviteMemberSchema.safeParse({
      email: "user@example.com",
      role: "MEMBER",
    });
    expect(result.success).toBe(true);
  });

  it("accepts ADMIN role", () => {
    const result = inviteMemberSchema.safeParse({
      email: "admin@example.com",
      role: "ADMIN",
    });
    expect(result.success).toBe(true);
  });

  it("accepts GUEST role", () => {
    const result = inviteMemberSchema.safeParse({
      email: "guest@example.com",
      role: "GUEST",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = inviteMemberSchema.safeParse({
      email: "not-an-email",
      role: "MEMBER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing email", () => {
    const result = inviteMemberSchema.safeParse({ role: "MEMBER" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid role", () => {
    const result = inviteMemberSchema.safeParse({
      email: "user@example.com",
      role: "OWNER",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty email", () => {
    const result = inviteMemberSchema.safeParse({
      email: "",
      role: "MEMBER",
    });
    expect(result.success).toBe(false);
  });
});
