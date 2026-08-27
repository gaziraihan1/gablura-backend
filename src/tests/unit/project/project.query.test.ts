import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectQuery } from "../../../modules/project/project.query.js";
import { prisma } from "../../../lib/prisma.js";
import { NotFoundError } from "../../../errors/index.js";
import { CacheClient } from "../../../lib/redis/cache.client.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/project/project.access.js", () => ({
  ProjectAccess: {
    assertWorkspaceAccess: vi.fn(),
    isProjectAdmin: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock("../../../modules/project/project.stats.js", () => ({
  calculateProjectStats: vi.fn().mockReturnValue({
    totalTasks: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    overdueTasks: 0,
    totalMembers: 0,
    projectDays: 1,
    topPerformer: null,
  }),
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    CacheClient: {
      ...actual.CacheClient,
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("ProjectQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getUserProjects", () => {
    it("should return cached projects if available", async () => {
      const cached = [{ id: "p1", name: "Cached Project" }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);
      const result = await ProjectQuery.getUserProjects("u1");
      // Cache hits are ALSO normalized — guarantees the wire shape even for
      // entries written before an upgrade (e.g. missing workspace/members).
      expect(result).toEqual([
        {
          id: "p1",
          name: "Cached Project",
          workspace: null,
          members: [],
          isAdmin: false,
        },
      ]);
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });

    it("should fetch from db and cache them", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      const mockProjects = [
        { id: "p1", name: "Project 1", workspace: { id: "ws1", ownerId: "u1", name: "WS", slug: "ws" }, members: [], _count: { tasks: 0 } },
        { id: "p2", name: "Project 2", workspace: { id: "ws2", ownerId: "u2", name: "WS2", slug: "ws2" }, members: [], _count: { tasks: 0 } },
      ];
      vi.mocked(prisma.project.findMany).mockResolvedValue(mockProjects as any);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([]);
      const result = await ProjectQuery.getUserProjects("u1");
      expect(result).toHaveLength(2);
      expect(CacheClient.set).toHaveBeenCalled();
    });

    it("should mark user as admin for owned workspaces", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "p1", name: "My Project", workspace: { id: "ws1", ownerId: "u1", name: "WS", slug: "ws" }, members: [], _count: { tasks: 0 } },
      ] as any);
      const result = await ProjectQuery.getUserProjects("u1") as any[];
      expect(result[0].isAdmin).toBe(true);
    });

    // Regression: Project.workspaceId is nullable and the compound FK
    // (workspaceId, workspaceSlug) means legacy rows resolve `workspace` to
    // null. This must not throw (production 500 on GET /projects/user/all).
    it("should not crash when a project has no workspace (null relation)", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "p-orphan", name: "Orphan Project", workspaceId: null, workspaceSlug: null, workspace: null, members: [{ userId: "u1" }], _count: { tasks: 0 } },
        { id: "p2", name: "Other's Project", workspace: { id: "ws2", ownerId: "u2", name: "WS2", slug: "ws2" }, members: [], _count: { tasks: 0 } },
      ] as any);
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([]);

      const result = await ProjectQuery.getUserProjects("u1") as any[];

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("p-orphan");
      expect(result[0].isAdmin).toBe(false); // null workspace → not owner/admin
      expect(CacheClient.set).toHaveBeenCalled();
    });
  });

  describe("getProjectsByWorkspace", () => {
    it("should assert workspace access before fetching", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findMany).mockResolvedValue([]);
      await ProjectQuery.getProjectsByWorkspace("u1", "ws1");
      expect(ProjectAccess.assertWorkspaceAccess).toHaveBeenCalledWith("u1", "ws1");
    });

    it("should return cached projects if available", async () => {
      const { ProjectAccess } = await import("../../../modules/project/project.access.js");
      const cached = [{ id: "p1", name: "Cached" }];
      vi.mocked(CacheClient.get).mockResolvedValue(cached);
      (ProjectAccess.assertWorkspaceAccess as any).mockResolvedValue({ id: "ws1" });
      const result = await ProjectQuery.getProjectsByWorkspace("u1", "ws1");
      // Cache hits are ALSO normalized — collections/counts are guaranteed.
      expect(result).toEqual([
        {
          id: "p1",
          name: "Cached",
          members: [],
          _count: { tasks: 0, members: 0 },
        },
      ]);
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getProjectDetails", () => {
    it("should return cached project details if available", async () => {
      const cached = { id: "p1", name: "Cached" };
      vi.mocked(CacheClient.get).mockResolvedValue(cached);
      const result = await ProjectQuery.getProjectDetails("u1", "p1");
      expect(result).toEqual(cached);
      expect(prisma.project.findFirst).not.toHaveBeenCalled();
    });

    it("should fetch details and compute stats", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      const mockProject = {
        id: "p1", name: "Project 1",
        workspace: { id: "ws1", ownerId: "u1", name: "WS", slug: "ws" },
        members: [], tasks: [],
        _count: { tasks: 5, members: 3, announcement: 0 },
      };
      vi.mocked(prisma.project.findFirst).mockResolvedValue(mockProject as any);
      const result = await ProjectQuery.getProjectDetails("u1", "p1") as any;
      expect(result.id).toBe("p1");
      expect(result.stats).toBeDefined();
      expect(result.isAdmin).toBe(true);
      expect(CacheClient.set).toHaveBeenCalled();
    });

    it("should throw NotFoundError if project not found", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      await expect(ProjectQuery.getProjectDetails("u1", "p1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("getProjectBySlug", () => {
    it("should return cached project with access verification", async () => {
      const cached = { id: "p1", workspaceId: "ws1" };
      vi.mocked(CacheClient.get).mockResolvedValue(cached);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: "ws1" } as any);
      const result = await ProjectQuery.getProjectBySlug("u1", "test-slug") as any;
      expect(result).toEqual({ ...cached, isAdmin: true });
      expect(prisma.workspace.findFirst).toHaveBeenCalled();
    });

    it("should throw if cached but no access", async () => {
      const cached = { id: "p1", workspaceId: "ws1" };
      vi.mocked(CacheClient.get).mockResolvedValue(cached);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      await expect(ProjectQuery.getProjectBySlug("u1", "test-slug")).rejects.toThrow(NotFoundError);
    });

    it("should fetch by slug if cache miss", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findFirst).mockResolvedValue({
        id: "p1", workspaceId: "ws1",
        workspace: { id: "ws1", ownerId: "u1", name: "WS", slug: "ws" },
        members: [], tasks: [],
        _count: { tasks: 0, members: 0, announcement: 0 },
      } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ id: "ws1" } as any);
      const result = await ProjectQuery.getProjectBySlug("u1", "test-slug") as any;
      expect(result.id).toBe("p1");
      expect(CacheClient.set).toHaveBeenCalled();
    });

    it("should throw NotFoundError if slug not found", async () => {
      vi.mocked(CacheClient.get).mockResolvedValue(null);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null);
      await expect(ProjectQuery.getProjectBySlug("u1", "nonexistent")).rejects.toThrow(NotFoundError);
    });
  });
});

