import { StorageProvider } from "./storage.provider.js";
import { AttachmentRepository } from "./attachment.repository.js";
import { AttachmentAccess } from "./attachment.access.js";
import {
  checkAndConsumeUploadQuota,
  rollbackUploadQuota,
  incrementWorkspaceStorage,
  decrementWorkspaceStorage,
  seedWorkspaceStorageFromDb,
} from "./attatchment.quota.service.js";
import type { AddAttachmentInput } from "./attachment.types.js";
import { WorkspacePlan } from "./attachment.quota.types.js";
import { prisma } from "../../lib/prisma.js";
import { addLogActivityJob, addUpdateStorageQuotaJob } from "../../queue/index.js";

async function ensureStorageSeeded(workspaceId: string) {
  const agg = await AttachmentRepository.aggregateWorkspaceSize(workspaceId);
  await seedWorkspaceStorageFromDb(workspaceId, agg._sum.size ?? 0);
}

async function resolveWorkspaceSlug(workspaceId: string): Promise<string> {
  const ws = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { slug: true },
  });
  return ws.slug;
}

export const AttachmentService = {
  async addAttachment(input: AddAttachmentInput) {
    const { workspaceId, workspacePlan } =
      await AttachmentAccess.assertCanAttach(input.taskId, input.userId);

    await ensureStorageSeeded(workspaceId);

    const quota = await checkAndConsumeUploadQuota(
      input.userId,
      workspaceId,
      workspacePlan as WorkspacePlan,
      input.file.size,
    );

    if (!quota.allowed) {
      throw Object.assign(new Error(quota.reason), {
        code: quota.code,
        retryAfterMs: quota.retryAfterMs,
      });
    }

    const base64 = input.file.buffer.toString("base64");
    const dataURI = `data:${input.file.mimetype};base64,${base64}`;

    let uploadResult;
    try {
      uploadResult = await StorageProvider.upload(dataURI);
    } catch (err) {
      await rollbackUploadQuota(input.userId, workspaceId);
      throw new Error("Failed to upload file to storage");
    }

    let file;
    try {
      file = await AttachmentRepository.createFile({
        name: uploadResult.public_id,
        originalName: input.file.originalname,
        size: uploadResult.bytes,
        mimeType: input.file.mimetype,
        url: uploadResult.secure_url,
        thumbnail: uploadResult.thumbnail_url ?? null,
        uploadedById: input.userId,
        workspaceId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
      });
    } catch (err) {
      await Promise.allSettled([
        StorageProvider.destroy(uploadResult.public_id),
        rollbackUploadQuota(input.userId, workspaceId),
      ]);
      throw new Error("Failed to save file record");
    }

    addUpdateStorageQuotaJob({
      workspaceId,
      bytes: uploadResult.bytes,
      operation: "increment",
    }).catch(() => {});

    const workspaceSlug = await resolveWorkspaceSlug(workspaceId);
    addLogActivityJob({
      action: "UPLOADED",
      entityType: "FILE",
      entityId: file.id,
      userId: input.userId,
      workspaceId,
      workspaceSlug,
      taskId: input.taskId,
      metadata: {
        fileName: file.originalName,
        fileSize: uploadResult.bytes,
        mimeType: file.mimeType,
        fileUrl: file.url,
      },
    }).catch(() => {});

    return file;
  },

  async deleteAttachment(fileId: string, userId: string) {
    const file = await AttachmentAccess.assertCanDelete(fileId, userId);

    const taskId = file.taskId ?? undefined;
    const workspaceId = file.workspaceId ?? undefined;

    const deleted = await AttachmentRepository.deleteFile(fileId);

    if (deleted.count === 0) return;

    StorageProvider.destroy(file.name).catch(() => {});

    if (workspaceId) {
      addUpdateStorageQuotaJob({
        workspaceId,
        bytes: file.size,
        operation: "decrement",
      }).catch(() => {});

      const workspaceSlug = await resolveWorkspaceSlug(workspaceId);
      addLogActivityJob({
        action: "DELETED",
        entityType: "FILE",
        entityId: fileId,
        userId,
        workspaceId,
        workspaceSlug,
        taskId,
        metadata: {
          fileName: file.originalName,
          fileSize: file.size,
        },
      }).catch(() => {});
    }
  },
};