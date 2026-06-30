import { describe, it, expect, vi, beforeEach } from "vitest";
import { AnnouncementService } from "../../../modules/announcement/announcement.service.js";
import { AnnouncementRepository } from "../../../modules/announcement/announcement.repository.js";
import { prisma } from "../../../lib/prisma.js";
import { ForbiddenError, BadRequestError, NotFoundError } from "../../../errors/index.js";
import { WorkspaceRole } from "@prisma/client";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/announcement/announcement.repository.js", () => ({
  AnnouncementRepository: {
    isWorkspaceMember: vi.fn(),
    isProjectMember: vi.fn(),
    isPUblicWorkspace: vi.fn(),
    isWorkspaceGuest: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findMany: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
}));

describe("AnnouncementService", () => {
  const mockUser = "user-1";
  const mockWsSlug = "test-ws";
  const mockProjectId = "proj-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    const validInput = {
      title: "Test Title",
      content: "Test Content",
      visibility: "PUBLIC" as const,
      workspaceSlug: mockWsSlug,
      createdById: mockUser,
    };

    it("should throw ForbiddenError if user is not a workspace member", async () => {
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue(null);
      await expect(AnnouncementService.create(validInput)).rejects.toThrow(ForbiddenError);
    });

    it("should throw ForbiddenError if non-admin tries to create workspace announcement", async () => {
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.MEMBER } as any);
      await expect(AnnouncementService.create(validInput)).rejects.toThrow(ForbiddenError);
    });

    it("should allow OWNER to create workspace announcement", async () => {
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.OWNER } as any);
      vi.mocked(AnnouncementRepository.create).mockResolvedValue({ id: "ann-1" } as any);
      
      const result = await AnnouncementService.create(validInput);
      expect(result.id).toBe("ann-1");
    });

    it("should validate project and project-member role for project announcements", async () => {
      const projectInput = { ...validInput, projectId: mockProjectId };
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.MEMBER } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: mockProjectId } as any);
      
      // Case 1: Not a project member
      vi.mocked(AnnouncementRepository.isProjectMember).mockResolvedValue(null);
      await expect(AnnouncementService.create(projectInput)).rejects.toThrow(ForbiddenError);

      // Case 2: Project manager (can create)
      vi.mocked(AnnouncementRepository.isProjectMember).mockResolvedValue({ role: "MANAGER" } as any);
      vi.mocked(AnnouncementRepository.create).mockResolvedValue({ id: "ann-1" } as any);
      const result = await AnnouncementService.create(projectInput);
      expect(result.id).toBe("ann-1");
    });

    it("should throw BadRequestError if private announcement has no targets", async () => {
      const privateInput = { ...validInput, visibility: "PRIVATE" as const };
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.OWNER } as any);
      await expect(AnnouncementService.create(privateInput)).rejects.toThrow(BadRequestError);
    });

    it("should throw BadRequestError if target users are not workspace members", async () => {
      const privateInput = { ...validInput, visibility: "PRIVATE" as const, targetIds: ["u2"] };
      vi.mocked(AnnouncementRepository.isWorkspaceMember)
        .mockResolvedValueOnce({ role: WorkspaceRole.OWNER } as any) // creator
        .mockResolvedValueOnce(null); // target u2
      
      await expect(AnnouncementService.create(privateInput)).rejects.toThrow(BadRequestError);
    });
  });

  describe("getMany", () => {
    it("should throw ForbiddenError if user has no access (not member, not guest, not public)", async () => {
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue(null);
      vi.mocked(AnnouncementRepository.isWorkspaceGuest).mockResolvedValue(false);
      vi.mocked(AnnouncementRepository.isPUblicWorkspace).mockResolvedValue(false);
      
      await expect(AnnouncementService.getMany({ workspaceSlug: mockWsSlug, userId: mockUser }))
        .rejects.toThrow(ForbiddenError);
    });

    it("should allow access if workspace is public", async () => {
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue(null);
      vi.mocked(AnnouncementRepository.isWorkspaceGuest).mockResolvedValue(false);
      vi.mocked(AnnouncementRepository.isPUblicWorkspace).mockResolvedValue(true);
      vi.mocked(AnnouncementRepository.findMany).mockResolvedValue({ data: [], pagination: {} } as any);
      
      const result = await AnnouncementService.getMany({ workspaceSlug: mockWsSlug, userId: mockUser });
      expect(result).toBeDefined();
    });

    it("should verify project access when projectId is provided", async () => {
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.MEMBER } as any);
      vi.mocked(prisma.project.findFirst).mockResolvedValue(null); // Project doesn't exist
      
      await expect(AnnouncementService.getMany({ workspaceSlug: mockWsSlug, userId: mockUser, projectId: mockProjectId }))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe("getOne", () => {
    it("should throw NotFoundError if announcement missing", async () => {
      vi.mocked(AnnouncementRepository.findById).mockResolvedValue(null);
      await expect(AnnouncementService.getOne("id", mockUser)).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if user cannot view announcement", async () => {
      vi.mocked(AnnouncementRepository.findById).mockResolvedValue({
        id: "ann-1",
        visibility: "PRIVATE",
        createdById: "other",
        targets: [],
      } as any);
      // canViewAnnouncement logic: not creator, not target
      await expect(AnnouncementService.getOne("ann-1", mockUser)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("delete", () => {
    it("should throw ForbiddenError if user is not a member", async () => {
      vi.mocked(AnnouncementRepository.findById).mockResolvedValue({ id: "ann-1", workspaceSlug: mockWsSlug } as any);
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue(null);
      await expect(AnnouncementService.delete("ann-1", mockUser)).rejects.toThrow(ForbiddenError);
    });

    it("should throw ForbiddenError if non-admin tries to delete workspace announcement", async () => {
      vi.mocked(AnnouncementRepository.findById).mockResolvedValue({ id: "ann-1", workspaceSlug: mockWsSlug, projectId: null } as any);
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.MEMBER } as any);
      await expect(AnnouncementService.delete("ann-1", mockUser)).rejects.toThrow(ForbiddenError);
    });

    it("should allow OWNER to delete", async () => {
      vi.mocked(AnnouncementRepository.findById).mockResolvedValue({ id: "ann-1", workspaceSlug: mockWsSlug, projectId: null } as any);
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.OWNER } as any);
      vi.mocked(AnnouncementRepository.delete).mockResolvedValue(undefined);
      
      await expect(AnnouncementService.delete("ann-1", mockUser)).resolves.not.toThrow();
    });
  });

  describe("togglePin", () => {
    it("should throw ForbiddenError if non-admin tries to pin", async () => {
      vi.mocked(AnnouncementRepository.findById).mockResolvedValue({ id: "ann-1", workspaceSlug: mockWsSlug, projectId: null } as any);
      vi.mocked(AnnouncementRepository.isWorkspaceMember).mockResolvedValue({ role: WorkspaceRole.MEMBER } as any);
      await expect(AnnouncementService.togglePin("ann-1", mockUser)).rejects.toThrow(ForbiddenError);
    });
  });
});
