import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceAccess } from "../../../modules/workspace/workspace.access.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../../../errors/AppError.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    workspace: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
  },
}));

describe("WorkspaceAccess", () => {
  const mockUserId = "user-1";
  const mockWorkspaceId = "ws-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("assertViewer", () => {
    it("returns member info when user is a member", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        id: mockWorkspaceId,
        isPublic: false,
        members: [{ id: "mem-1", role: "MEMBER" }],
      } as any);

      const result = await WorkspaceAccess.assertViewer(mockWorkspaceId, mockUserId);

      expect(result.isMember).toBe(true);
      expect(result.isPublic).toBe(false);
      expect(result.member).toEqual({ id: "mem-1", role: "MEMBER" });
    });

    it("returns viewer info when workspace is public and user is not a member", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        id: mockWorkspaceId,
        isPublic: true,
        members: [],
      } as any);

      const result = await WorkspaceAccess.assertViewer(mockWorkspaceId, mockUserId);

      expect(result.isMember).toBe(false);
      expect(result.isPublic).toBe(true);
      expect(result.member).toBeNull();
    });

    it("throws NotFoundError when workspace is not found and not public", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(
        WorkspaceAccess.assertViewer(mockWorkspaceId, mockUserId),
      ).rejects.toThrow(NotFoundError);
    });

    it("queries with OR condition for public or membership", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        id: mockWorkspaceId,
        isPublic: false,
        members: [],
      } as any);

      await WorkspaceAccess.assertViewer(mockWorkspaceId, mockUserId);

      expect(prisma.workspace.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { isPublic: true },
              { members: { some: { userId: mockUserId } } },
            ]),
          }),
        }),
      );
    });
  });

  describe("assertMember", () => {
    it("returns member when user is a member", async () => {
      const mockMember = {
        id: "mem-1",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: "MEMBER",
      };
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(
        mockMember as any,
      );

      const result = await WorkspaceAccess.assertMember(
        mockWorkspaceId,
        mockUserId,
      );

      expect(result).toEqual(mockMember);
    });

    it("throws ForbiddenError when user is not a member", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(null);

      await expect(
        WorkspaceAccess.assertMember(mockWorkspaceId, mockUserId),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe("assertAdmin", () => {
    it("returns member when user has OWNER role", async () => {
      const mockMember = {
        id: "mem-1",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: "OWNER",
      };
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(
        mockMember as any,
      );

      const result = await WorkspaceAccess.assertAdmin(
        mockWorkspaceId,
        mockUserId,
      );

      expect(result).toEqual(mockMember);
    });

    it("returns member when user has ADMIN role", async () => {
      const mockMember = {
        id: "mem-1",
        userId: mockUserId,
        workspaceId: mockWorkspaceId,
        role: "ADMIN",
      };
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(
        mockMember as any,
      );

      const result = await WorkspaceAccess.assertAdmin(
        mockWorkspaceId,
        mockUserId,
      );

      expect(result).toEqual(mockMember);
    });

    it("throws ForbiddenError when user is not OWNER or ADMIN", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue(null);

      await expect(
        WorkspaceAccess.assertAdmin(mockWorkspaceId, mockUserId),
      ).rejects.toThrow(ForbiddenError);
    });

    it("queries with role in [OWNER, ADMIN]", async () => {
      vi.mocked(prisma.workspaceMember.findFirst).mockResolvedValue({
        role: "ADMIN",
      } as any);

      await WorkspaceAccess.assertAdmin(mockWorkspaceId, mockUserId);

      expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: { in: ["OWNER", "ADMIN"] },
          }),
        }),
      );
    });
  });

  describe("assertOwner", () => {
    it("returns workspace when user is the owner", async () => {
      const mockWorkspace = {
        id: mockWorkspaceId,
        ownerId: mockUserId,
        name: "Test WS",
      };
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(
        mockWorkspace as any,
      );

      const result = await WorkspaceAccess.assertOwner(
        mockWorkspaceId,
        mockUserId,
      );

      expect(result).toEqual(mockWorkspace);
    });

    it("throws ForbiddenError when user is not the owner", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue(null);

      await expect(
        WorkspaceAccess.assertOwner(mockWorkspaceId, mockUserId),
      ).rejects.toThrow(ForbiddenError);
    });

    it("queries by workspace id and ownerId", async () => {
      vi.mocked(prisma.workspace.findFirst).mockResolvedValue({
        id: mockWorkspaceId,
        ownerId: mockUserId,
      } as any);

      await WorkspaceAccess.assertOwner(mockWorkspaceId, mockUserId);

      expect(prisma.workspace.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockWorkspaceId, ownerId: mockUserId },
        }),
      );
    });
  });
});
