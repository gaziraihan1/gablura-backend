import { describe, it, expect, vi, beforeEach } from "vitest";
import { StorageMutation } from "../../../modules/storage/storage.mutation.js";
import { StorageAccess } from "../../../modules/storage/storage.access.js";
import { prisma } from "../../../lib/prisma.js";
import { 
  getWorkspaceStorageBytes, 
  incrementWorkspaceStorage, 
  decrementWorkspaceStorage, 
  seedWorkspaceStorageFromDb, 
  getStorageLimits 
} from "../../../modules/attachment/attatchment.quota.service.js";
import { ForbiddenError, NotFoundError } from "../../../errors/AppError.js";

vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    file: {
      aggregate: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("../../../modules/storage/storage.access.js", () => ({
  StorageAccess: {
    isAdmin: vi.fn(),
    assertMember: vi.fn(),
  },
}));

vi.mock("../../../modules/attachment/attatchment.quota.service.js", () => ({
  getWorkspaceStorageBytes: vi.fn(),
  incrementWorkspaceStorage: vi.fn(() => Promise.resolve()),
  decrementWorkspaceStorage: vi.fn(() => Promise.resolve()),
  seedWorkspaceStorageFromDb: vi.fn(() => Promise.resolve()),
  getStorageLimits: vi.fn(),
}));

vi.mock("cloudinary", () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      destroy: vi.fn(() => Promise.resolve()),
    },
  },
}));

describe("StorageMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bulkDeleteFiles", () => {
    const mockFiles = [
      { id: "f1", name: "n1", size: 100, uploadedById: "user1" },
      { id: "f2", name: "n2", size: 200, uploadedById: "user2" },
    ];

    it("should delete files when user is owner", async () => {
      vi.mocked(StorageAccess.isAdmin).mockResolvedValue(false);
      vi.mocked(prisma.file.findMany).mockResolvedValue(mockFiles as any);
      vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 1 } as any);

      const result = await StorageMutation.bulkDeleteFiles(["f1"], "ws1", "user1");

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(1);
      expect(prisma.file.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["f1"] } },
      });
    });

    it("should delete files when user is admin", async () => {
      vi.mocked(StorageAccess.isAdmin).mockResolvedValue(true);
      vi.mocked(prisma.file.findMany).mockResolvedValue(mockFiles as any);
      vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 2 } as any);

      const result = await StorageMutation.bulkDeleteFiles(["f1", "f2"], "ws1", "admin1");

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(2);
    });

    it("should only delete files the user has permission for (non-admin)", async () => {
      vi.mocked(StorageAccess.isAdmin).mockResolvedValue(false);
      vi.mocked(prisma.file.findMany).mockResolvedValue(mockFiles as any);
      vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 1 } as any);

      const result = await StorageMutation.bulkDeleteFiles(["f1", "f2"], "ws1", "user1");

      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(1);
      expect(prisma.file.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["f1"] } },
      });
    });

    it("should throw NotFoundError if no files found", async () => {
      vi.mocked(prisma.file.findMany).mockResolvedValue([]);

      await expect(StorageMutation.bulkDeleteFiles(["f1"], "ws1", "user1")).rejects.toThrow(NotFoundError);
    });

    it("should throw ForbiddenError if user has no permission for any file", async () => {
      vi.mocked(StorageAccess.isAdmin).mockResolvedValue(false);
      vi.mocked(prisma.file.findMany).mockResolvedValue([
        { id: "f1", name: "n1", size: 100, uploadedById: "user2" },
      ] as any);

      await expect(StorageMutation.bulkDeleteFiles(["f1"], "ws1", "user1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("deleteFile", () => {
    it("should delete file when user is owner", async () => {
      vi.mocked(prisma.file.findFirst).mockResolvedValue({
        id: "f1",
        name: "n1",
        size: 100,
        uploadedById: "user1",
        workspaceId: "ws1",
        workspace: { members: [{ role: "MEMBER" }] },
      } as any);

      const result = await StorageMutation.deleteFile("f1", "user1");

      expect(result.success).toBe(true);
      expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    });

    it("should delete file when user is admin", async () => {
      vi.mocked(prisma.file.findFirst).mockResolvedValue({
        id: "f1",
        name: "n1",
        size: 100,
        uploadedById: "user2",
        workspaceId: "ws1",
        workspace: { members: [{ role: "ADMIN" }] },
      } as any);

      const result = await StorageMutation.deleteFile("f1", "user1");

      expect(result.success).toBe(true);
    });

    it("should throw ForbiddenError if user is not owner or admin", async () => {
      vi.mocked(prisma.file.findFirst).mockResolvedValue({
        id: "f1",
        name: "n1",
        size: 100,
        uploadedById: "user2",
        workspaceId: "ws1",
        workspace: { members: [{ role: "MEMBER" }] },
      } as any);

      await expect(StorageMutation.deleteFile("f1", "user1")).rejects.toThrow(ForbiddenError);
    });

    it("should throw NotFoundError if file not found", async () => {
      vi.mocked(prisma.file.findFirst).mockResolvedValue(null);

      await expect(StorageMutation.deleteFile("f1", "user1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("canUploadFile", () => {
    const mockWs = { id: "ws1", plan: "FREE", maxStorage: 100 * 1024 * 1024 };
    const mockLimits = { maxStorageBytes: 100 * 1024 * 1024, maxFileSizeBytes: 5 * 1024 * 1024 };

    beforeEach(() => {
      vi.mocked(prisma.workspace.findUnique).mockResolvedValue(mockWs as any);
      vi.mocked(getStorageLimits).mockReturnValue(mockLimits as any);
      vi.mocked(prisma.file.aggregate).mockResolvedValue({
        _sum: { size: 0 },
      } as any);
    });

    it("should allow upload if within limits", async () => {
      vi.mocked(getWorkspaceStorageBytes).mockResolvedValue(10 * 1024 * 1024);

      const result = await StorageMutation.canUploadFile("ws1", "user1", 1 * 1024 * 1024);

      expect(result.allowed).toBe(true);
    });

    it("should reject upload if file too large for plan", async () => {
      const result = await StorageMutation.canUploadFile("ws1", "user1", 10 * 1024 * 1024);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds the 5 MB per-file limit");
    });

    it("should reject upload if workspace storage full", async () => {
      vi.mocked(getWorkspaceStorageBytes).mockResolvedValue(99 * 1024 * 1024);

      const result = await StorageMutation.canUploadFile("ws1", "user1", 2 * 1024 * 1024);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Storage full");
    });
  });

  describe("recordFileUpload", () => {
    it("should record file upload successfully", async () => {
      const params = {
        userId: "user1",
        workspaceId: "ws1",
        name: "n1",
        originalName: "on1",
        size: 100,
        mimeType: "image/jpeg",
        url: "url1",
      };
      vi.mocked(prisma.file.create).mockResolvedValue({ id: "f1", ...params } as any);

      const result = await StorageMutation.recordFileUpload(params);

      expect(result.id).toBe("f1");
      expect(prisma.file.create).toHaveBeenCalled();
      expect(incrementWorkspaceStorage).toHaveBeenCalledWith("ws1", 100);
    });
  });
});
