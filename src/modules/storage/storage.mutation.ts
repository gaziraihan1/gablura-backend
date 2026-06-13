import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../../lib/prisma.js";
import type { BulkDeleteResult, UploadCheckResult } from "./storage.types.js";
import { StorageAccess } from "./storage.access.js";
import { toMB, getMaxFileSizeForPlan } from "./storage.utils.js";
import {
  getWorkspaceStorageBytes,
  incrementWorkspaceStorage,
  decrementWorkspaceStorage,
  seedWorkspaceStorageFromDb,
  getStorageLimits,
} from "../attachment/attatchment.quota.service.js";
import { WorkspacePlan } from "../attachment/attachment.quota.types.js";
import { ForbiddenError, NotFoundError } from "../../errors/AppError.js";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureStorageSeeded(workspaceId: string): Promise<void> {
  const agg = await prisma.file.aggregate({
    where: { workspaceId },
    _sum:  { size: true },
  });
  await seedWorkspaceStorageFromDb(workspaceId, agg._sum.size ?? 0);
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export const StorageMutation = {
  async bulkDeleteFiles(
    fileIds:     string[],
    workspaceId: string,
    userId:      string,
  ): Promise<BulkDeleteResult & { success: boolean; message: string }> {
    const isAdmin = await StorageAccess.isAdmin(userId, workspaceId);

    const files = await prisma.file.findMany({
      where:  { id: { in: fileIds }, workspaceId },
      select: { id: true, name: true, size: true, uploadedById: true },
    });

    if (files.length === 0) {
      throw new NotFoundError("Files", "NOT_FOUND")
    }

    const deletable = files.filter((f) => f.uploadedById === userId || isAdmin);

    if (deletable.length === 0) throw new ForbiddenError("You do not have permission to delete these files")

    const totalBytes = deletable.reduce((sum, f) => sum + f.size, 0);

    await prisma.file.deleteMany({ where: { id: { in: deletable.map((f) => f.id) } } });

    // Cloudinary cleanup (best-effort, non-blocking)
    Promise.allSettled(
      deletable.map((f) => cloudinary.uploader.destroy(f.name)),
    ).catch((err) => console.error("Bulk Cloudinary cleanup error:", err));

    // Reclaim storage in Redis (best-effort)
    decrementWorkspaceStorage(workspaceId, totalBytes).catch((err) =>
      console.error("Failed to decrement storage after bulk delete:", err),
    );

    return {
      success:      true,
      message:      `${deletable.length} file(s) deleted successfully`,
      deletedCount: deletable.length,
      freedMB:      toMB(totalBytes),
    };
  },

  async deleteFile(
    fileId: string,
    userId: string,
  ): Promise<{ success: boolean; message: string; freedMB: number; workspaceId?: string }> {
    const file = await prisma.file.findFirst({
      where:  { id: fileId },
      select: {
        id:           true,
        name:         true,
        size:         true,
        uploadedById: true,
        workspaceId:  true,
        workspace: {
          select: {
            members: {
              where:  { userId },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!file) throw new NotFoundError("Files", "NOT_FOUND")

    const isOwner = file.uploadedById === userId;
    const isAdmin =
      file.workspace?.members[0]?.role === "OWNER" ||
      file.workspace?.members[0]?.role === "ADMIN";

    if (!isOwner && !isAdmin) {
      throw new ForbiddenError("You do not have permission to delete these files")
    }

    await prisma.file.delete({ where: { id: fileId } });

    // Cloudinary cleanup (best-effort)
    cloudinary.uploader
      .destroy(file.name)
      .catch((err) => console.error("Cloudinary delete failed:", err));

    // Reclaim storage in Redis (best-effort)
    if (file.workspaceId) {
      decrementWorkspaceStorage(file.workspaceId, file.size).catch((err) =>
        console.error("Failed to decrement storage after delete:", err),
      );
    }

    return {
      success:     true,
      message:     "File deleted successfully",
      freedMB:     toMB(file.size),
      workspaceId: file.workspaceId ?? undefined,
    };
  },

  async canUploadFile(
    workspaceId:   string,
    userId:        string,
    fileSizeBytes: number,
  ): Promise<UploadCheckResult & { usedMB: number; remainingMB: number; totalMB: number; plan: string }> {
    const ws = await prisma.workspace.findUnique({
      where:  { id: workspaceId },
      select: { plan: true, maxStorage: true } as any,
    });
    const plan   = ((ws as any)?.plan   ?? "FREE") as WorkspacePlan;
    const totalMB =
      ((ws as any)?.maxStorage as number) ??
      toMB(getStorageLimits(plan).maxStorageBytes ?? 0);

    await ensureStorageSeeded(workspaceId);
    const usedBytes    = await getWorkspaceStorageBytes(workspaceId);
    const usedMB       = toMB(usedBytes);
    const remainingMB  = Math.max(0, totalMB - usedMB);
    const fileSizeMB   = fileSizeBytes / (1024 * 1024);
    const limits       = getStorageLimits(plan);
    const maxFileSizeMB = limits.maxFileSizeBytes / (1024 * 1024);

    if (fileSizeMB > maxFileSizeMB) {
      return {
        allowed:     false,
        reason:      `File size ${fileSizeMB.toFixed(1)} MB exceeds the ${maxFileSizeMB} MB per-file limit on the ${plan} plan.`,
        usedMB,
        remainingMB,
        totalMB,
        plan,
      };
    }

    if (limits.maxStorageBytes !== null && usedBytes + fileSizeBytes > limits.maxStorageBytes) {
      return {
        allowed:     false,
        reason:      `Storage full. ${remainingMB.toFixed(2)} MB remaining — need ${fileSizeMB.toFixed(2)} MB.`,
        usedMB,
        remainingMB,
        totalMB,
        plan,
      };
    }

    return { allowed: true, usedMB, remainingMB, totalMB, plan };
  },

  async recordFileUpload(params: {
    userId:       string;
    workspaceId:  string;
    name:         string;
    originalName: string;
    size:         number;
    mimeType:     string;
    url:          string;
    thumbnail?:   string;
    folder?:      string;
    projectId?:   string;
    taskId?:      string;
  }) {
    await StorageAccess.assertMember(params.userId, params.workspaceId);

    const file = await prisma.file.create({
      data: {
        name:         params.name,
        originalName: params.originalName,
        size:         params.size,
        mimeType:     params.mimeType,
        url:          params.url,
        thumbnail:    params.thumbnail,
        folder:       params.folder,
        uploadedById: params.userId,
        workspaceId:  params.workspaceId,
        projectId:    params.projectId,
        taskId:       params.taskId,
      },
    });

    // Update Redis storage counter after successful DB write
    incrementWorkspaceStorage(params.workspaceId, params.size).catch((err) =>
      console.error("Failed to increment storage after recordFileUpload:", err),
    );

    return file;
  },
};