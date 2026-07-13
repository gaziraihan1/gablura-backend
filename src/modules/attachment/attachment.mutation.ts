import { StorageProvider }        from './storage.provider.js';
import { AttachmentRepository }   from './attachment.repository.js';
import { AttachmentAccess }       from './attachment.access.js';
import {
  checkAndConsumeUploadQuota,
  rollbackUploadQuota,
  incrementWorkspaceStorage,
  decrementWorkspaceStorage,
  seedWorkspaceStorageFromDb,
} from './attatchment.quota.service.js';
import type { AddAttachmentInput } from './attachment.types.js';
import { WorkspacePlan }           from './attachment.quota.types.js';
import { QuotaError }              from '../../errors/index.js';
import { prisma }                  from '../../lib/prisma.js';

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

export const AttachmentMutation = {
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
      // quota.code is one of the QuotaError union literals
      throw new QuotaError(
        quota.reason!,
        quota.code as ConstructorParameters<typeof QuotaError>[1],
        quota.retryAfterMs,
      );
    }

    const base64  = input.file.buffer.toString('base64');
    const dataURI = `data:${input.file.mimetype};base64,${base64}`;

    let uploadResult;
    try {
      uploadResult = await StorageProvider.upload(dataURI);
    } catch (err) {
      await rollbackUploadQuota(input.userId, workspaceId);
      throw err; // let errorHandler produce a 500 — no message wrapping needed
    }

    let file;
    try {
      file = await AttachmentRepository.createFile({
        name:         uploadResult.public_id,
        originalName: input.file.originalname,
        size:         uploadResult.bytes,
        mimeType:     input.file.mimetype,
        url:          uploadResult.secure_url,
        thumbnail:    uploadResult.thumbnail_url ?? null,
        uploadedById: input.userId,
        workspaceId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
      });
    } catch (err) {
      await Promise.allSettled([
        StorageProvider.destroy(uploadResult.public_id),
        rollbackUploadQuota(input.userId, workspaceId),
      ]);
      throw err;
    }

    // Fire-and-forget — non-fatal
    incrementWorkspaceStorage(workspaceId, uploadResult.bytes).catch(() => {});
    const workspaceSlug = await resolveWorkspaceSlug(workspaceId);
    AttachmentRepository.createActivity({
      action:     'UPLOADED',
      entityType: 'FILE',
      entityId:   file.id,
      userId:     input.userId,
      workspaceId,
      workspaceSlug,
      taskId:     input.taskId,
      metadata: {
        fileName: file.originalName,
        fileSize: uploadResult.bytes,
        mimeType: file.mimeType,
        fileUrl:  file.url,
      },
    }).catch(() => {});

    return file;
  },

  async deleteAttachment(fileId: string, userId: string) {
    const file = await AttachmentAccess.assertCanDelete(fileId, userId);

    const taskId      = file.taskId      ?? undefined;
    const workspaceId = file.workspaceId ?? undefined;

    const deleted = await AttachmentRepository.deleteFile(fileId);
    if (deleted.count === 0) return;

    // Fire-and-forget — non-fatal
    StorageProvider.destroy(file.name).catch(() => {});

    if (workspaceId) {
      decrementWorkspaceStorage(workspaceId, file.size).catch(() => {});
      const workspaceSlug = await resolveWorkspaceSlug(workspaceId);
      AttachmentRepository.createActivity({
        action:     'DELETED',
        entityType: 'FILE',
        entityId:   fileId,
        userId,
        workspaceId,
        workspaceSlug,
        taskId,
        metadata: { fileName: file.originalName, fileSize: file.size },
      }).catch(() => {});
    }
  },
};