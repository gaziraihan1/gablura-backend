import { describe, it, expect, vi, beforeEach } from "vitest";
import { StorageQuery } from "../../../modules/storage/storage.query.js";
import { StorageAccess } from "../../../modules/storage/storage.access.js";
import { prisma } from "../../../lib/prisma.js";
import {
  getStorageLimits,
  getWorkspaceStorageBytes,
  seedWorkspaceStorageFromDb,
} from "../../../modules/attachment/attatchment.quota.service.js";
import { toMB, getCategoryFromMimeType } from "../../../modules/storage/storage.utils.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    file: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/storage/storage.access.js", () => ({
  StorageAccess: {
    assertMemberWithWorkspace: vi.fn(),
    assertMember: vi.fn(),
    assertAdmin: vi.fn(),
  },
}));

vi.mock("../../../modules/attachment/attatchment.quota.service.js", () => ({
  getStorageLimits: vi.fn(),
  getWorkspaceStorageBytes: vi.fn(),
  seedWorkspaceStorageFromDb: vi.fn(),
}));

vi.mock("../../../modules/storage/storage.utils.js", () => ({
  toMB: vi.fn((bytes) => bytes / (1024 * 1024)),
  getCategoryFromMimeType: vi.fn((mimeType) => {
    if (mimeType.startsWith("image/")) return "Images";
    return "Other";
  }),
}));

describe("StorageQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWorkspaceStorageInfo", () => {
    it("should return workspace storage info", async () => {
      vi.mocked(StorageAccess.assertMemberWithWorkspace).mockResolvedValue({
        workspace: {
          id: "workspace1",
          name: "Test Workspace",
          plan: "PRO",
          maxStorage: 1000,
        },
        role: "ADMIN",
      });
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: 500 * 1024 * 1024 },
      } as any);
      vi.mocked(seedWorkspaceStorageFromDb).mockResolvedValue(undefined);
      vi.mocked(getWorkspaceStorageBytes).mockResolvedValue(500 * 1024 * 1024);
      vi.mocked(getStorageLimits).mockReturnValue({
        maxStorageBytes: 10 * 1024 * 1024 * 1024, // PRO = 10 GB
      } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getWorkspaceStorageInfo("workspace1", "user1");

      expect(result).toEqual({
        usedMB: 500,
        totalMB: 10240,
        remainingMB: 9740,
        percentage: 5,
        plan: "PRO",
        workspaceId: "workspace1",
        workspaceName: "Test Workspace",
      });
    });

    it("should handle zero usage", async () => {
      vi.mocked(StorageAccess.assertMemberWithWorkspace).mockResolvedValue({
        workspace: {
          id: "workspace1",
          name: "Test Workspace",
          plan: "FREE",
          maxStorage: 100,
        },
        role: "MEMBER",
      });
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: 0 },
      } as any);
      vi.mocked(seedWorkspaceStorageFromDb).mockResolvedValue(undefined);
      vi.mocked(getWorkspaceStorageBytes).mockResolvedValue(0);
      vi.mocked(getStorageLimits).mockReturnValue({
        maxStorageBytes: 1024 * 1024 * 1024, // FREE = 1 GB
      } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getWorkspaceStorageInfo("workspace1", "user1");

      expect(result.percentage).toBe(0);
      expect(result.remainingMB).toBe(1024);
    });
  });

  describe("getWorkspaceStorageBreakdown", () => {
    it("should return storage breakdown by category", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.aggregate)
        .mockResolvedValueOnce({ _sum: { size: 100 * 1024 * 1024 } } as any)
        .mockResolvedValueOnce({ _sum: { size: 200 * 1024 * 1024 } } as any)
        .mockResolvedValueOnce({ _sum: { size: 300 * 1024 * 1024 } } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getWorkspaceStorageBreakdown("workspace1", "user1");

      expect(result).toEqual({
        attachments: 100,
        projectFiles: 200,
        workspaceFiles: 300,
        total: 600,
      });
    });
  });

  describe("getUserContributions", () => {
    it("should return user contributions for admin", async () => {
      vi.mocked(StorageAccess.assertAdmin).mockResolvedValue(undefined);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: 1000 * 1024 * 1024 },
      } as any);
      vi.mocked(prisma.file.groupBy).mockResolvedValue([
        {
          uploadedById: "user1",
          _sum: { size: 500 * 1024 * 1024 },
          _count: { uploadedById: 10 },
        },
        {
          uploadedById: "user2",
          _sum: { size: 500 * 1024 * 1024 },
          _count: { uploadedById: 5 },
        },
      ] as any);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "user1", name: "User One", email: "user1@example.com" },
        { id: "user2", name: "User Two", email: "user2@example.com" },
      ] as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getUserContributions("workspace1", "admin1");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        userId: "user1",
        userName: "User One",
        userEmail: "user1@example.com",
        usageMB: 500,
        fileCount: 10,
        percentage: 50,
      });
    });

    it("should sort contributions by usage descending", async () => {
      vi.mocked(StorageAccess.assertAdmin).mockResolvedValue(undefined);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: 1000 * 1024 * 1024 },
      } as any);
      vi.mocked(prisma.file.groupBy).mockResolvedValue([
        {
          uploadedById: "user1",
          _sum: { size: 200 * 1024 * 1024 },
          _count: { uploadedById: 5 },
        },
        {
          uploadedById: "user2",
          _sum: { size: 800 * 1024 * 1024 },
          _count: { uploadedById: 15 },
        },
      ] as any);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: "user1", name: "User One", email: "user1@example.com" },
        { id: "user2", name: "User Two", email: "user2@example.com" },
      ] as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getUserContributions("workspace1", "admin1");

      expect(result[0].userId).toBe("user2");
      expect(result[1].userId).toBe("user1");
    });
  });

  describe("getMyContribution", () => {
    it("should return user's own contribution", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.aggregate)
        .mockResolvedValueOnce({ _sum: { size: 100 * 1024 * 1024 }, _count: { id: 5 } } as any)
        .mockResolvedValueOnce({ _sum: { size: 1000 * 1024 * 1024 } } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getMyContribution("workspace1", "user1");

      expect(result).toEqual({
        usageMB: 100,
        fileCount: 5,
        percentage: 10,
      });
    });

    it("should handle zero contribution", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.aggregate)
        .mockResolvedValueOnce({ _sum: { size: 0 }, _count: { id: 0 } } as any)
        .mockResolvedValueOnce({ _sum: { size: 0 } } as any);
      vi.mocked(toMB).mockReturnValue(0);

      const result = await StorageQuery.getMyContribution("workspace1", "user1");

      expect(result).toEqual({
        usageMB: 0,
        fileCount: 0,
        percentage: 0,
      });
    });
  });

  describe("getLargestFiles", () => {
    it("should return largest files", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.findMany).mockResolvedValue([
        {
          id: "file1",
          name: "file1.jpg",
          originalName: "original1.jpg",
          size: 10 * 1024 * 1024,
          mimeType: "image/jpeg",
          url: "https://example.com/file1.jpg",
          uploadedAt: new Date("2024-01-01"),
          uploadedBy: { id: "user1", name: "User One", email: "user1@example.com" },
          task: { id: "task1", title: "Task One" },
          project: { id: "project1", name: "Project One" },
        },
      ] as any);
      vi.mocked(toMB).mockReturnValue(10);

      const result = await StorageQuery.getLargestFiles("workspace1", "user1", 10);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "file1",
        name: "file1.jpg",
        originalName: "original1.jpg",
        size: 10 * 1024 * 1024,
        sizeMB: 10,
        mimeType: "image/jpeg",
        url: "https://example.com/file1.jpg",
        uploadedAt: new Date("2024-01-01"),
        uploadedBy: { id: "user1", name: "User One", email: "user1@example.com" },
        task: { id: "task1", title: "Task One" },
        project: { id: "project1", name: "Project One" },
      });
    });

    it("should use default limit of 10", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.findMany).mockResolvedValue([]);
      vi.mocked(toMB).mockReturnValue(0);

      await StorageQuery.getLargestFiles("workspace1", "user1");

      expect(prisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        }),
      );
    });
  });

  describe("getStorageTrend", () => {
    it("should return storage trend over days", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.findMany).mockResolvedValue([
        {
          uploadedAt: new Date("2024-01-01"),
          size: 100 * 1024 * 1024,
        },
      ] as any);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: 50 * 1024 * 1024 },
      } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getStorageTrend("workspace1", "user1", 30);

      expect(result).toHaveLength(30);
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("usageMB");
    });
  });

  describe("getFileTypeBreakdown", () => {
    it("should return file type breakdown", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.groupBy).mockResolvedValue([
        {
          mimeType: "image/jpeg",
          _count: { mimeType: 10 },
          _sum: { size: 100 * 1024 * 1024 },
        },
        {
          mimeType: "application/pdf",
          _count: { mimeType: 5 },
          _sum: { size: 50 * 1024 * 1024 },
        },
      ] as any);
      vi.mocked(getCategoryFromMimeType).mockImplementation((mimeType) => {
        if (mimeType.startsWith("image/")) return "Images";
        return "Other";
      });
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getFileTypeBreakdown("workspace1", "user1");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        mimeType: "image/jpeg",
        category: "Images",
        count: 10,
        sizeMB: 100,
      });
    });

    it("should sort by size descending", async () => {
      vi.mocked(StorageAccess.assertMember).mockResolvedValue("MEMBER");
      vi.mocked(prisma.file.groupBy).mockResolvedValue([
        {
          mimeType: "image/jpeg",
          _count: { mimeType: 10 },
          _sum: { size: 50 * 1024 * 1024 },
        },
        {
          mimeType: "application/pdf",
          _count: { mimeType: 5 },
          _sum: { size: 100 * 1024 * 1024 },
        },
      ] as any);
      vi.mocked(getCategoryFromMimeType).mockReturnValue("Other");
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getFileTypeBreakdown("workspace1", "user1");

      expect(result[0].mimeType).toBe("application/pdf");
      expect(result[1].mimeType).toBe("image/jpeg");
    });
  });

  describe("getUserWorkspacesSummary", () => {
    it("should return user workspaces summary", async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: "user1",
          workspaceId: "workspace1",
          role: "ADMIN",
          workspace: {
            id: "workspace1",
            name: "Workspace One",
            plan: "PRO",
            maxStorage: 1000,
          },
        },
      ] as any);
      vi.mocked(prisma.file.groupBy).mockResolvedValue([
        {
          workspaceId: "workspace1",
          _sum: { size: 500 * 1024 * 1024 },
          _count: { id: 10 },
        },
      ] as any);
      vi.mocked(seedWorkspaceStorageFromDb).mockResolvedValue(undefined);
      vi.mocked(getStorageLimits).mockReturnValue({
        maxStorageBytes: 10 * 1024 * 1024 * 1024, // PRO = 10 GB
      } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getUserWorkspacesSummary("user1");

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        workspaceId: "workspace1",
        workspaceName: "Workspace One",
        plan: "PRO",
        usageMB: 500,
        totalMB: 10240,
        remainingMB: 9740,
        percentage: 5,
        role: "ADMIN",
        fileCount: 10,
      });
    });

    it("should sort by usage descending", async () => {
      vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([
        {
          userId: "user1",
          workspaceId: "workspace1",
          role: "ADMIN",
          workspace: {
            id: "workspace1",
            name: "Workspace One",
            plan: "PRO",
            maxStorage: 1000,
          },
        },
        {
          userId: "user1",
          workspaceId: "workspace2",
          role: "MEMBER",
          workspace: {
            id: "workspace2",
            name: "Workspace Two",
            plan: "FREE",
            maxStorage: 100,
          },
        },
      ] as any);
      vi.mocked(prisma.file.groupBy).mockResolvedValue([
        {
          workspaceId: "workspace1",
          _sum: { size: 200 * 1024 * 1024 },
          _count: { id: 5 },
        },
        {
          workspaceId: "workspace2",
          _sum: { size: 800 * 1024 * 1024 },
          _count: { id: 15 },
        },
      ] as any);
      vi.mocked(seedWorkspaceStorageFromDb).mockResolvedValue(undefined);
      vi.mocked(getStorageLimits).mockReturnValue({
        maxStorageBytes: 10 * 1024 * 1024 * 1024, // PRO = 10 GB
      } as any);
      vi.mocked(toMB).mockImplementation((bytes) => bytes / (1024 * 1024));

      const result = await StorageQuery.getUserWorkspacesSummary("user1");

      expect(result[0].workspaceId).toBe("workspace2");
      expect(result[1].workspaceId).toBe("workspace1");
    });
  });
});
