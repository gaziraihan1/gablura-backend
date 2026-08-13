import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceMutation } from "../../../modules/workspace/workspace.mutation.js";
import { prisma } from "../../../lib/prisma.js";
import { CacheClient, WorkspaceCache } from "../../../lib/redis/cache.client.js";
import { ConflictError, BadRequestError, ForbiddenError, NotFoundError } from "../../../errors/AppError.js";
import { sendInvitationEmail } from "../../../utils/email.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    workspaceMember: {
      create: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    workspaceInvitation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the queue module to prevent job execution in tests
vi.mock("../../../queue/index.js", () => ({
  addInvalidateCacheJob: vi.fn().mockResolvedValue(undefined),
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
    WorkspaceCache: {
      ...actual.WorkspaceCache,
      invalidateUserWorkspaces: vi.fn().mockResolvedValue(undefined),
      invalidateWorkspace: vi.fn().mockResolvedValue(undefined),
      invalidateMembers: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../../../utils/email.js", () => ({
  sendInvitationEmail: vi.fn(),
}));

describe("WorkspaceMutation", () => {
  const mockUser = { id: "user-1", name: "Test User" };
  const mockWorkspace = {
    id: "ws-1",
    slug: "test-ws",
    name: "Test Workspace",
    ownerId: "user-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // assertNotSuspended (used by update/delete/invite/removeMember/role) reads
    // workspace.deletedAt via findUnique. Only treat the workspace lookups as
    // found; slug-uniqueness checks (create) must return null so the slug
    // generator does not loop forever on a permanently-taken slug.
    (prisma.workspace.findUnique as any).mockImplementation(async (args: any) => {
      if (args?.select?.deletedAt) return { deletedAt: null } as any;
      if (args?.select?.ownerId) return { deletedAt: null, ownerId: "ws-owner" } as any;
      return null;
    });
  });

  describe("create", () => {
    it("creates a workspace and owner membership", async () => {
      vi.mocked(prisma.workspace.create).mockResolvedValue(mockWorkspace as any);

      const result = await WorkspaceMutation.create(mockUser.id, { name: "New WS" });

      expect(prisma.workspace.create).toHaveBeenCalled();
      expect(WorkspaceCache.invalidateUserWorkspaces).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual(mockWorkspace);
    });

    it("retries once with a fresh slug when a concurrent create hits P2002", async () => {
      // Pass 1 of generateUniqueSlug: slug is free -> "new-ws".
      // Pass 2 (retry): the conflicting row now exists -> "new-ws" taken,
      // then the "-1" variant is free -> "new-ws-1".
      vi.mocked(prisma.workspace.findUnique)
        .mockResolvedValueOnce(null)                       // pass 1: free
        .mockResolvedValueOnce({ slug: "new-ws" } as any) // pass 2: taken
        .mockResolvedValueOnce(null);                      // pass 2: -1 free

      const p2002 = Object.assign(new Error("unique violation"), {
        code: "P2002",
        meta: { target: ["slug"] },
      });
      vi.mocked(prisma.workspace.create)
        .mockRejectedValueOnce(p2002)
        .mockResolvedValueOnce({ ...mockWorkspace, slug: "new-ws-1" } as any);

      const result = await WorkspaceMutation.create(mockUser.id, { name: "New WS" });

      expect(prisma.workspace.create).toHaveBeenCalledTimes(2);
      const secondCall = vi.mocked(prisma.workspace.create).mock.calls[1][0];
      expect(secondCall.data.slug).toBe("new-ws-1");
      expect(WorkspaceCache.invalidateUserWorkspaces).toHaveBeenCalledWith(mockUser.id);
      expect(result.slug).toBe("new-ws-1");
    });
  });

  describe("update", () => {
    it("updates workspace and invalidates cache", async () => {
      // Mock WorkspaceAccess.assertAdmin (it usually checks member role)
      // In this project, WorkspaceAccess is likely just wrapper around prisma
      // We can't easily mock WorkspaceAccess because it's an object of functions
      // But we can mock the prisma calls it makes.
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "ADMIN" } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue(mockWorkspace as any);

      const result = await WorkspaceMutation.update("ws-1", mockUser.id, { name: "Updated Name" });

      expect(prisma.workspace.update).toHaveBeenCalled();
      expect(WorkspaceCache.invalidateWorkspace).toHaveBeenCalled();
      expect(result).toEqual(mockWorkspace);
    });

    it("throws ForbiddenError if user is not admin", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(null);

      await expect(WorkspaceMutation.update("ws-1", mockUser.id, { name: "Updated" }))
        .rejects.toThrow(ForbiddenError);
    });

    it("throws ConflictError when the update hits a slug conflict (P2002)", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "ADMIN" } as any);
      const p2002 = Object.assign(new Error("unique violation"), {
        code: "P2002",
        meta: { target: ["slug"] },
      });
      vi.mocked(prisma.workspace.update).mockRejectedValue(p2002);

      await expect(
        WorkspaceMutation.update("ws-1", mockUser.id, { name: "Updated" }),
      ).rejects.toThrow(ConflictError);
    });
  });

  describe("delete", () => {
    it("soft-deletes workspace if user is owner (recoverable, no cascade wipe)", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "OWNER" } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(mockWorkspace as any);
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
      // Explicit mock: an earlier test leaves a P2002 rejection on update via
      // mockRejectedValue (clearAllMocks only clears call history, not impls).
      vi.mocked(prisma.workspace.update).mockResolvedValue(mockWorkspace as any);

      await WorkspaceMutation.delete("ws-1", mockUser.id);

      // No hard delete — the row is marked deletedAt so admins can restore it.
      expect(prisma.workspace.delete).not.toHaveBeenCalled();
      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws-1" },
        data: {
          deletedAt:    expect.any(Date),
          deletedById:  mockUser.id,
          deleteReason: "Deleted by owner",
        },
      });
      expect(WorkspaceCache.invalidateWorkspace).toHaveBeenCalledWith("ws-1", mockWorkspace.slug);
      expect(WorkspaceCache.invalidateUserWorkspaces).toHaveBeenCalledWith(mockWorkspace.ownerId);
    });

    it("throws ForbiddenError if user is not owner", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "ADMIN" } as any);
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(WorkspaceMutation.delete("ws-1", mockUser.id))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe("inviteMember", () => {
    it("creates invitation and sends email", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "ADMIN" } as any);
      vi.mocked(prisma.workspaceInvitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValueOnce({ role: "ADMIN" } as any); // admin check
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValueOnce(null); // member check
      vi.mocked(prisma.workspaceInvitation.create).mockResolvedValue({ token: "token-123", workspace: mockWorkspace } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);

      const result = await WorkspaceMutation.inviteMember("ws-1", mockUser.id, "invitee@example.com", "MEMBER");

      expect(prisma.workspaceInvitation.create).toHaveBeenCalled();
      expect(sendInvitationEmail).toHaveBeenCalled();
      expect(result.token).toBe("token-123");
    });

    it("throws ConflictError if user is already member", async () => {
      vi.mocked(prisma.workspaceMember.findFirst)
        .mockResolvedValueOnce({ role: "ADMIN" } as any) // admin check
        .mockResolvedValueOnce({ userId: "u2" } as any); // member check

      await expect(WorkspaceMutation.inviteMember("ws-1", mockUser.id, "member@example.com", "MEMBER"))
        .rejects.toThrow(ConflictError);
    });
  });

  describe("acceptInvitation", () => {
    it("accepts invitation and creates membership", async () => {
      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
        token: "token-123",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 10000),
        email: "invitee@example.com",
        workspace: mockWorkspace,
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-2", email: "invitee@example.com" } as any);
      vi.mocked(prisma.workspaceMember.create).mockResolvedValue({ id: "mem-1" } as any);
      vi.mocked(prisma.workspaceInvitation.update).mockResolvedValue({} as any);

      const result = await WorkspaceMutation.acceptInvitation("token-123", "user-2");

      expect(prisma.workspaceMember.create).toHaveBeenCalled();
      expect(prisma.workspaceInvitation.update).toHaveBeenCalled();
      expect(result).toEqual(mockWorkspace);
    });

    it("throws BadRequestError if email mismatch", async () => {
      vi.mocked(prisma.workspaceInvitation.findUnique).mockResolvedValue({
        token: "token-123",
        status: "PENDING",
        expiresAt: new Date(Date.now() + 10000),
        email: "invitee@example.com",
        workspace: mockWorkspace,
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "user-2", email: "wrong@example.com" } as any);

      await expect(WorkspaceMutation.acceptInvitation("token-123", "user-2"))
        .rejects.toThrow(BadRequestError);
    });
  });

  describe("removeMember", () => {
    it("removes member if user is admin", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "ADMIN" } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ 
        id: "mem-1", 
        workspaceId: "ws-1",
        user: { notifications: true }, 
        workspace: { name: "WS" } 
      } as any);

      await WorkspaceMutation.removeMember("ws-1", mockUser.id, "mem-1");

      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it("throws NotFoundError if member not found", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ role: "ADMIN" } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue(null);

      await expect(WorkspaceMutation.removeMember("ws-1", mockUser.id, "mem-1"))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe("updateMemberRole", () => {
    it("updates role if user is owner", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ 
        role: "OWNER", 
        workspace: { name: "WS" } 
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({ 
        id: "mem-1",
        workspaceId: "ws-1"
      } as any);
      vi.mocked(prisma.workspaceMember.update).mockResolvedValue({ id: "mem-1", role: "ADMIN" } as any);

      const result = await WorkspaceMutation.updateMemberRole("ws-1", mockUser.id, "mem-1", "ADMIN");

      expect(prisma.workspaceMember.update).toHaveBeenCalled();
      expect(result.role).toBe("ADMIN");
    });

    it("throws ForbiddenError if user is not owner", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(null);

      await expect(WorkspaceMutation.updateMemberRole("ws-1", mockUser.id, "mem-1", "ADMIN"))
        .rejects.toThrow(ForbiddenError);
    });

    it("transfers ownership: promotes target, demotes previous owner, moves ownerId", async () => {
      // $transaction runs the callback with the (mocked) prisma client as tx
      (prisma as any).$transaction = vi.fn(async (cb: any) => cb(prisma));
      vi.mocked(WorkspaceCache.invalidateWorkspace).mockResolvedValue(undefined as any);

      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({
        role: "OWNER",
        userId: mockUser.id,
        workspace: { name: "WS" },
      } as any);
      vi.mocked(prisma.workspaceMember.findUnique).mockResolvedValue({
        id: "mem-2",
        workspaceId: "ws-1",
        role: "MEMBER",
        userId: "user-2",
      } as any);
      vi.mocked(prisma.workspaceMember.update).mockResolvedValue({
        id: "mem-2",
        role: "OWNER",
      } as any);
      vi.mocked(prisma.workspaceMember.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.workspace.update).mockResolvedValue({
        id: "ws-1",
        ownerId: "user-2",
      } as any);

      const result = await WorkspaceMutation.updateMemberRole(
        "ws-1",
        mockUser.id,
        "mem-2",
        "OWNER" as any,
      );

      expect(prisma.workspaceMember.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "mem-2" },
          data: { role: "OWNER" },
        }),
      );
      // Previous owner (mockUser.id) is demoted to ADMIN — single-owner invariant
      expect(prisma.workspaceMember.updateMany).toHaveBeenCalledWith({
        where: { workspaceId: "ws-1", userId: mockUser.id, role: "OWNER" },
        data: { role: "ADMIN" },
      });
      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: "ws-1" },
        data: { ownerId: "user-2" },
      });
      expect(result.role).toBe("OWNER");
    });
  });

  describe("leaveWorkspace", () => {
    it("allows member to leave", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ id: "mem-1", role: "MEMBER" } as any);

      await WorkspaceMutation.leaveWorkspace("ws-1", mockUser.id);

      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it("throws BadRequestError if user is owner", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({ id: "mem-1", role: "OWNER" } as any);

      await expect(WorkspaceMutation.leaveWorkspace("ws-1", mockUser.id))
        .rejects.toThrow(BadRequestError);
    });
  });
});
