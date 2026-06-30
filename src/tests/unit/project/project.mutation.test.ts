import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectMutation } from "../../../modules/project/project.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { BadRequestError, NotFoundError, ForbiddenError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    project: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    projectMember: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findFirst: vi.fn() },
    workspace: { findUnique: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: { assertWorkspaceAccess: vi.fn(), assertProjectAdminAccess: vi.fn(), isProjectAdmin: vi.fn() },
}));

vi.mock("../../../services/slug.service.js", () => ({
  SlugService: { generateProjectSlug: vi.fn().mockResolvedValue("test-project-slug") },
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    ProjectCache: { 
      invalidateWorkspaceProjects: vi.fn().mockResolvedValue(undefined), 
      invalidateUserProjects: vi.fn().mockResolvedValue(undefined), 
      invalidateProject: vi.fn().mockResolvedValue(undefined) 
    },
    WorkspaceCache: { invalidateWorkspace: vi.fn().mockResolvedValue(undefined) },
    AnalyticsCache: { invalidateWorkspace: vi.fn().mockResolvedValue(undefined) },
    CacheClient: { ...actual.CacheClient, get: vi.fn(), set: vi.fn() },
  };
});

describe("ProjectMutation", () => {
  beforeEach(() => { vi.clearAllMocks(); });


  describe("createProject", () => {
    it("should assert workspace access and create a project", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      const { SlugService } = await import("../../../services/slug.service.js");
      (ProjectAccess.assertWorkspaceAccess as any).mockResolvedValue({ id: "ws1" });
      (prisma.workspace.findUnique as any).mockResolvedValue({ id: "ws1", slug: "test-ws", name: "WS", ownerId: "u1" });
      (prisma.project.create as any).mockResolvedValue({ id: "p1", name: "Test Project" });
      const result = await ProjectMutation.createProject({ name: "Test Project", workspaceId: "ws1", createdById: "u1" });
      expect(SlugService.generateProjectSlug).toHaveBeenCalledWith("Test Project", "ws1");
      expect(prisma.project.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw NotFoundError if workspace not found", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertWorkspaceAccess as any).mockResolvedValue({ id: "ws1" });
      (prisma.workspace.findUnique as any).mockResolvedValue(null);
      await expect(ProjectMutation.createProject({ name: "P", workspaceId: "ws1", createdById: "u1" })).rejects.toThrow(NotFoundError);
    });
  });

  describe("updateProject", () => {
    it("should assert admin access and update", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ id: "p1" });
      (prisma.project.findUnique as any).mockResolvedValue({ workspaceId: "ws1", workspace: { slug: "ws" }, slug: "p1" });
      (prisma.project.update as any).mockResolvedValue({ id: "p1", name: "Updated" });
      const result = await ProjectMutation.updateProject("u1", "p1", { name: "Updated" });
      expect(prisma.project.update).toHaveBeenCalled();
      expect(result.name).toBe("Updated");
    });

    it("should set completedAt when status is COMPLETED", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ id: "p1" });
      (prisma.project.findUnique as any).mockResolvedValue({ workspaceId: "ws1", workspace: { slug: "ws" }, slug: "p1" });
      (prisma.project.update as any).mockResolvedValue({ id: "p1", status: "COMPLETED", completedAt: new Date() });
      await ProjectMutation.updateProject("u1", "p1", { status: "COMPLETED" as any });
      const updateCall = (prisma.project.update as any).mock.calls[0][0];
      expect(updateCall.data.completedAt).toBeDefined();
    });
  });

  describe("deleteProject", () => {
    it("should assert admin access and delete", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ id: "p1" });
      (prisma.project.findUnique as any).mockResolvedValue({ workspaceId: "ws1", workspace: { slug: "ws" }, slug: "p1" });
      await ProjectMutation.deleteProject("u1", "p1");
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: "p1" } });
    });
  });

  describe("addProjectMember", () => {
    it("should add a member to the project", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ workspaceId: "ws1" });
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: "wm1" });
      (prisma.projectMember.findFirst as any).mockResolvedValue(null);
      (prisma.projectMember.create as any).mockResolvedValue({ id: "pm1", userId: "u2", role: "COLLABORATOR", user: { id: "u2", name: "Bob", email: "bob@test.com", image: null } });
      const result = await ProjectMutation.addProjectMember("u1", "p1", { userId: "u2" });
      expect(prisma.projectMember.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("should throw BadRequestError if user not in workspace", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ workspaceId: "ws1" });
      (prisma.workspaceMember.findFirst as any).mockResolvedValue(null);
      await expect(ProjectMutation.addProjectMember("u1", "p1", { userId: "u2" })).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if user already a member", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ workspaceId: "ws1" });
      (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: "wm1" });
      (prisma.projectMember.findFirst as any).mockResolvedValue({ id: "pm1" });
      await expect(ProjectMutation.addProjectMember("u1", "p1", { userId: "u2" })).rejects.toThrow(BadRequestError);
    });
  });

  describe("updateProjectMemberRole", () => {
    it("should update member role", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ id: "p1" });
      (prisma.projectMember.update as any).mockResolvedValue({ id: "pm1", userId: "u2", role: "MANAGER", user: { id: "u2", name: "Bob", email: "bob@test.com", image: null } });
      const result = await ProjectMutation.updateProjectMemberRole("u1", "p1", "u2", { role: "MANAGER" as any });
      expect(result.role).toBe("MANAGER");
    });

    it("should throw ForbiddenError if not admin", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockRejectedValue(new ForbiddenError());
      await expect(ProjectMutation.updateProjectMemberRole("u1", "p1", "u2", { role: "MANAGER" as any })).rejects.toThrow(ForbiddenError);
    });
  });

  describe("removeProjectMember", () => {
    it("should remove a member from the project", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      (ProjectAccess.assertProjectAdminAccess as any).mockResolvedValue({ id: "p1" });
      await ProjectMutation.removeProjectMember("u1", "p1", "u2");
      expect(prisma.projectMember.delete).toHaveBeenCalledWith({ where: { projectId_userId: { projectId: "p1", userId: "u2" } } });
    });
  });
});
