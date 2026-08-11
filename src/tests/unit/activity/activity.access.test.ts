import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityAccess } from "../../../modules/activity/activity.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../../errors/index.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
    },
    activity: {
      findUnique: vi.fn(),
    },
  },
}));

describe("ActivityAccess", () => {
  const mockUserId = "user-1";
  const mockWorkspaceId = "ws-1";
  const mockTaskId = "task-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("canAccessWorkspace", () => {
    it("should return true if user is owner", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ ownerId: mockUserId } as any);
      const result = await ActivityAccess.canAccessWorkspace(mockUserId, mockWorkspaceId);
      expect(result).toBe(true);
    });

    it("should return true if user is member", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ 
        members: [{ userId: mockUserId }] 
      } as any);
      const result = await ActivityAccess.canAccessWorkspace(mockUserId, mockWorkspaceId);
      expect(result).toBe(true);
    });

    it("should return false if user has no access", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      const result = await ActivityAccess.canAccessWorkspace(mockUserId, mockWorkspaceId);
      expect(result).toBe(false);
    });
  });

  describe("isPublicWorkspace", () => {
    it("should return true if workspace is public", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ isPublic: true } as any);
      const result = await ActivityAccess.isPublicWorkspace(mockWorkspaceId);
      expect(result).toBe(true);
    });

    it("should return false if workspace is private", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue({ isPublic: false } as any);
      const result = await ActivityAccess.isPublicWorkspace(mockWorkspaceId);
      expect(result).toBe(false);
    });

    it("should return false if workspace not found", async () => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(null);
      const result = await ActivityAccess.isPublicWorkspace(mockWorkspaceId);
      expect(result).toBe(false);
    });
  });

  describe("canAccessTask", () => {
    it("should return true if user created the task", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ createdById: mockUserId } as any);
      const result = await ActivityAccess.canAccessTask(mockUserId, mockTaskId);
      expect(result).toBe(true);
    });

    it("should return true if user is an assignee", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ 
        assignees: [{ userId: mockUserId }] 
      } as any);
      const result = await ActivityAccess.canAccessTask(mockUserId, mockTaskId);
      expect(result).toBe(true);
    });

    it("should return true if user is member of task's workspace", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ 
        project: { workspace: { members: [{ userId: mockUserId }] } } 
      } as any);
      const result = await ActivityAccess.canAccessTask(mockUserId, mockTaskId);
      expect(result).toBe(true);
    });

    it("should return false if user has no relation to task", async () => {
      vi.mocked(prisma.task.findFirst).mockResolvedValue(null);
      const result = await ActivityAccess.canAccessTask(mockUserId, mockTaskId);
      expect(result).toBe(false);
    });
  });

  describe("getWorkspaceAccess", () => {
    it("owner without a membership row still gets full access", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        ownerId: mockUserId,
        members: [],
      } as any);
      const result = await ActivityAccess.getWorkspaceAccess(mockUserId, mockWorkspaceId);
      expect(result).toEqual({ hasAccess: true, isAdmin: true });
    });

    it("owner with OWNER membership row gets full access", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        ownerId: mockUserId,
        members: [{ role: "OWNER" }],
      } as any);
      const result = await ActivityAccess.getWorkspaceAccess(mockUserId, mockWorkspaceId);
      expect(result).toEqual({ hasAccess: true, isAdmin: true });
    });

    it("ADMIN member gets access and admin visibility", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        ownerId: "other",
        members: [{ role: "ADMIN" }],
      } as any);
      const result = await ActivityAccess.getWorkspaceAccess(mockUserId, mockWorkspaceId);
      expect(result).toEqual({ hasAccess: true, isAdmin: true });
    });

    it("regular MEMBER gets access but no admin visibility", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        ownerId: "other",
        members: [{ role: "MEMBER" }],
      } as any);
      const result = await ActivityAccess.getWorkspaceAccess(mockUserId, mockWorkspaceId);
      expect(result).toEqual({ hasAccess: true, isAdmin: false });
    });

    it("non-member gets no access", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        ownerId: "other",
        members: [],
      } as any);
      const result = await ActivityAccess.getWorkspaceAccess(mockUserId, mockWorkspaceId);
      expect(result).toEqual({ hasAccess: false, isAdmin: false });
    });

    it("missing workspace gets no access", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      const result = await ActivityAccess.getWorkspaceAccess(mockUserId, mockWorkspaceId);
      expect(result).toEqual({ hasAccess: false, isAdmin: false });
    });
  });

  describe("isWorkspaceAdmin", () => {
    it("should return true for OWNER", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ ownerId: mockUserId } as any);
      const result = await ActivityAccess.isWorkspaceAdmin(mockUserId, mockWorkspaceId);
      expect(result).toBe(true);
    });

    it("should return true for ADMIN member", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ 
        members: [{ userId: mockUserId, role: "ADMIN" }] 
      } as any);
      const result = await ActivityAccess.isWorkspaceAdmin(mockUserId, mockWorkspaceId);
      expect(result).toBe(true);
    });

    it("should return false for MEMBER", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      const result = await ActivityAccess.isWorkspaceAdmin(mockUserId, mockWorkspaceId);
      expect(result).toBe(false);
    });
  });

  describe("assertCanDelete", () => {
    it("should allow creator to delete", async () => {
      vi.mocked(prisma.activity.findUnique).mockResolvedValue({ userId: mockUserId } as any);
      await expect(ActivityAccess.assertCanDelete(mockUserId, "act-1")).resolves.not.toThrow();
    });

    it("should allow workspace admin to delete", async () => {
      vi.mocked(prisma.activity.findUnique).mockResolvedValue({ 
        userId: "other", 
        workspaceId: mockWorkspaceId 
      } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({ ownerId: mockUserId } as any);
      await expect(ActivityAccess.assertCanDelete(mockUserId, "act-1")).resolves.not.toThrow();
    });

    it("should throw NotFoundError if activity missing", async () => {
      vi.mocked(prisma.activity.findUnique).mockResolvedValue(null);
      await expect(ActivityAccess.assertCanDelete(mockUserId, "act-1")).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if no permission", async () => {
      vi.mocked(prisma.activity.findUnique).mockResolvedValue({ 
        userId: "other", 
        workspaceId: mockWorkspaceId 
      } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);
      await expect(ActivityAccess.assertCanDelete(mockUserId, "act-1")).rejects.toThrow(ForbiddenError);
    });
  });
});
