import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceQuery } from "../../../modules/workspace/workspace.query.js";
import { prisma } from "../../../lib/prisma.js";
import { CacheClient, CACHE_KEYS } from "../../../lib/redis/cache.client.js";
import { NotFoundError, ForbiddenError } from "../../../errors/AppError.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    project: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      count: vi.fn(),
    },
    workspaceInvitation: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../lib/redis/cache.client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/redis/cache.client.js")>();
  return {
    ...actual,
    CacheClient: {
      ...actual.CacheClient,
      get: vi.fn(),
      set: vi.fn(),
    },
  };
});

describe("WorkspaceQuery", () => {
  const mockUser = { id: "user-1" };
  const mockWorkspace = {
    id: "ws-1",
    slug: "test-ws",
    name: "Test Workspace",
    isPublic: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // assertNotSuspended (used by getMembers/getStats) reads workspace.deletedAt
    // via findUnique — default to an active workspace.
    vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ deletedAt: null } as any);
  });

  describe("getUserWorkspaces", () => {
    it("returns workspaces where user is a member", async () => {
      const workspaces = [mockWorkspace];
      vi.mocked(prisma.workspace.findMany).mockResolvedValue(workspaces as any);

      const result = await WorkspaceQuery.getUserWorkspaces(mockUser.id);
      
      expect(prisma.workspace.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { deletedAt: null, members: { some: { userId: mockUser.id } } },
      }));
      expect(result).toEqual(workspaces);
    });
  });

  describe("getBySlug", () => {
    it("returns cached workspace if available", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(mockWorkspace);

      const result = await WorkspaceQuery.getBySlug("test-ws", mockUser.id);

      expect(result).toEqual(mockWorkspace);
      expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
    });

    it("fetches from DB and caches if not in cache", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(mockWorkspace as any);

      const result = await WorkspaceQuery.getBySlug("test-ws", mockUser.id);

      expect(result).toEqual(mockWorkspace);
      // The cache key must be scoped to the requesting user so a cached
      // detail payload (member roster included) is never served to another
      // user — see the authz regression: non-members must not inherit a
      // member's cache entry.
      expect(CacheClient.get).toHaveBeenCalledWith(CACHE_KEYS.workspaceBySlug("test-ws", mockUser.id));
      expect(CacheClient.set).toHaveBeenCalledWith(
        CACHE_KEYS.workspaceBySlug("test-ws", mockUser.id),
        mockWorkspace,
        expect.any(Number),
      );
    });

    it("throws NotFoundError if workspace not found", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(WorkspaceQuery.getBySlug("invalid", mockUser.id))
        .rejects.toThrow(NotFoundError);
    });

    it("never writes a cache entry when the workspace is not visible (404 path)", async () => {
      // Non-member / non-public lookup → DB returns nothing → NotFound,
      // and crucially nothing is cached (so an unprivileged user can never
      // seed or later read a workspace detail entry).
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(WorkspaceQuery.getBySlug("private-ws", mockUser.id))
        .rejects.toThrow(NotFoundError);
      expect(CacheClient.set).not.toHaveBeenCalled();
    });

    it("uses a distinct cache entry per user", async () => {
      // User A's cache entry must never be readable by user B.
      vi.mocked(CacheClient.get).mockResolvedValueOnce(mockWorkspace);

      await WorkspaceQuery.getBySlug("test-ws", "user-b");

      expect(CacheClient.get).toHaveBeenCalledWith(CACHE_KEYS.workspaceBySlug("test-ws", "user-b"));
      expect(CacheClient.get).not.toHaveBeenCalledWith(CACHE_KEYS.workspaceBySlug("test-ws", mockUser.id));
    });
  });

  describe("getById", () => {
    it("returns cached workspace if available", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(mockWorkspace);

      const result = await WorkspaceQuery.getById("ws-1", mockUser.id);

      expect(result).toEqual(mockWorkspace);
      expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
    });

    it("fetches from DB and caches if not in cache", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(mockWorkspace as any);

      const result = await WorkspaceQuery.getById("ws-1", mockUser.id);

      expect(result).toEqual(mockWorkspace);
      expect(CacheClient.get).toHaveBeenCalledWith(CACHE_KEYS.workspaceById("ws-1", mockUser.id));
      expect(CacheClient.set).toHaveBeenCalledWith(
        CACHE_KEYS.workspaceById("ws-1", mockUser.id),
        mockWorkspace,
        expect.any(Number),
      );
    });

    it("throws NotFoundError if workspace not found", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(WorkspaceQuery.getById("invalid", mockUser.id))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe("getMembers", () => {
    it("returns members of the workspace", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ userId: mockUser.id, workspaceId: "ws-1" } as any);
      const members = [{ userId: "u1", role: "ADMIN" }];
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue(members as any);

      const result = await WorkspaceQuery.getMembers("ws-1", mockUser.id);

      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { workspaceId: "ws-1" },
      }));
      expect(result).toEqual(members);
    });
  });

  describe("computeStats", () => {
    it("returns cached stats if available", async () => {
      const stats = { totalProjects: 1, totalTasks: 10, totalMembers: 5, completedTasks: 5, overdueTasks: 2, completionRate: 50 };
      vi.mocked(CacheClient.get).mockResolvedValueOnce(stats);

      const result = await WorkspaceQuery.computeStats("ws-1");

      expect(result).toEqual(stats);
      expect(prisma.project.count).not.toHaveBeenCalled();
    });

    it("computes stats and caches them", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.project.count).mockResolvedValue(5);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(10);
      
      (vi.mocked(prisma.task.count).mockImplementation as any)(async (args: any) => {
        const where = args.where;
        if (where?.status === "COMPLETED") return 60;
        if (where?.dueDate?.lt) return 10;
        return 100; // totalTasks
      });

      const result = await WorkspaceQuery.computeStats("ws-1");

      expect(result.totalProjects).toBe(5);
      expect(result.totalTasks).toBe(100);
      expect(result.completionRate).toBe(60);
      expect(result.overdueTasks).toBe(10);
      expect(CacheClient.set).toHaveBeenCalled();
    });
  });

  describe("getOverview", () => {
    it("returns cached overview if available", async () => {
      const overview = { workspace: mockWorkspace, stats: {}, projects: [] };
      vi.mocked(CacheClient.get).mockResolvedValueOnce(overview);

      const result = await WorkspaceQuery.getOverview("test-ws", mockUser.id);

      expect(result).toEqual(overview);
      expect(prisma.workspace.findFirst).not.toHaveBeenCalled();
      // Overview payload embeds the workspace detail (member roster) — its
      // cache key must be user-scoped too.
      expect(CacheClient.get).toHaveBeenCalledWith(CACHE_KEYS.workspaceOverview("test-ws", mockUser.id));
    });

    it("throws ForbiddenError if workspace is suspended", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        ...mockWorkspace,
        deletedAt: new Date(),
      } as any);

      await expect(WorkspaceQuery.getOverview("test-ws", mockUser.id))
        .rejects.toThrow(ForbiddenError);
    });

    it("throws NotFoundError if workspace not found", async () => {
      vi.mocked(CacheClient.get).mockResolvedValueOnce(null);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(WorkspaceQuery.getOverview("test-ws", mockUser.id))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe("getInvitationByToken", () => {
    it("returns invitation if token is valid", async () => {
      const invitation = { token: "token-123", workspace: mockWorkspace };
      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(invitation as any);

      const result = await WorkspaceQuery.getInvitationByToken("token-123");

      expect(result).toEqual(invitation);
    });

    it("throws NotFoundError if token is invalid", async () => {
      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue(null);

      await expect(WorkspaceQuery.getInvitationByToken("invalid"))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe("getStats", () => {
    it("returns stats when user has viewer access", async () => {
      // assertViewer passes
      vi.mocked(prisma.workspace.findFirst).mockResolvedValueOnce({
        id: "ws-1",
        isPublic: false,
        members: [{ id: "mem-1", role: "MEMBER" }],
      } as any);
      // computeStats mocks
      vi.mocked(prisma.project.count).mockResolvedValue(3);
      vi.mocked(prisma.workspaceMember.count).mockResolvedValue(8);
      (vi.mocked(prisma.task.count).mockImplementation as any)(
        async (args: any) => {
          const where = args.where;
          if (where?.status === "COMPLETED") return 40;
          if (where?.dueDate?.lt) return 5;
          return 50;
        },
      );

      const result = await WorkspaceQuery.getStats("ws-1", "user-1");

      expect(result.totalProjects).toBe(3);
      expect(result.totalTasks).toBe(50);
      expect(result.totalMembers).toBe(8);
      expect(result.completedTasks).toBe(40);
      expect(result.overdueTasks).toBe(5);
      expect(result.completionRate).toBe(80);
    });

    it("throws NotFoundError when user has no access", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValueOnce(null);

      await expect(
        WorkspaceQuery.getStats("ws-1", "outsider"),
      ).rejects.toThrow(NotFoundError);
    });
  });

});
