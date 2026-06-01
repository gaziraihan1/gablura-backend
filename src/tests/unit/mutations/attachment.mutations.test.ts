import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentMutation } from '../../../modules/attachment/attachment.mutation.js';

/* ───────────────────────────────
   PRISMA MOCK (CRITICAL FIX)
────────────────────────────── */
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    file: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { size: 0 } }),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    activity: {
      create: vi.fn().mockResolvedValue(true),
    },
  },
}));

import { prisma } from '../../../lib/prisma.js';

/* ───────────────────────────────
   CLOUDINARY MOCK (SAFE)
────────────────────────────── */
vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: vi.fn(),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));

import { v2 as cloudinary } from 'cloudinary';

/* ───────────────────────────────
   QUOTA MOCK
────────────────────────────── */
vi.mock('../../../modules/attachment/attatchment.quota.service.js', () => ({
  checkAndConsumeUploadQuota: vi.fn(),
  rollbackUploadQuota: vi.fn().mockResolvedValue(undefined),
  incrementWorkspaceStorage: vi.fn().mockResolvedValue(undefined),
  decrementWorkspaceStorage: vi.fn().mockResolvedValue(undefined),
  seedWorkspaceStorageFromDb: vi.fn().mockResolvedValue(undefined),
}));

import {
  checkAndConsumeUploadQuota,
  rollbackUploadQuota,
} from '../../../modules/attachment/attatchment.quota.service.js';

/* ───────────────────────────────
   ACCESS MOCK
────────────────────────────── */
vi.mock('../../../modules/attachment/attachment.access.js', () => ({
  AttachmentAccess: {
    assertCanAttach: vi.fn(),
    assertCanDelete: vi.fn(),
  },
}));

import { AttachmentAccess } from '../../../modules/attachment/attachment.access.js';

/* ───────────────────────────────
   TESTS
────────────────────────────── */
describe('AttachmentMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /* ───────────────────────────────
     ADD ATTACHMENT
  ─────────────────────────────── */

  it('uploads file successfully and creates DB record', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId: 'ws1',
      workspacePlan: 'FREE',
    });

    (checkAndConsumeUploadQuota as any).mockResolvedValue({
      allowed: true,
    });

    (cloudinary.uploader.upload as any).mockResolvedValue({
      public_id: 'file_123',
      bytes: 1000,
      secure_url: 'https://file.url',
      thumbnail_url: null,
    });

    (prisma.file.create as any).mockResolvedValue({
      id: 'file_db_1',
      originalName: 'test.txt',
      size: 1000,
      url: 'https://file.url',
    });

    const result = await AttachmentMutation.addAttachment({
      userId: 'user1',
      taskId: 'task1',
      file: {
        buffer: Buffer.from('hello'),
        mimetype: 'text/plain',
        originalname: 'test.txt',
        size: 1000,
      } as any,
    });

    expect(result.originalName).toBe('test.txt');
    expect(cloudinary.uploader.upload).toHaveBeenCalled();
    expect(prisma.file.create).toHaveBeenCalled();
  });

  it('throws when quota is exceeded', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId: 'ws1',
      workspacePlan: 'FREE',
    });

    (checkAndConsumeUploadQuota as any).mockResolvedValue({
      allowed: false,
      reason: 'Quota exceeded',
      code: 'QUOTA_EXCEEDED',
      retryAfterMs: 1000,
    });

    await expect(
      AttachmentMutation.addAttachment({
        userId: 'user1',
        taskId: 'task1',
        file: {
          buffer: Buffer.from('x'),
          mimetype: 'text/plain',
          originalname: 'a.txt',
          size: 100,
        } as any,
      }),
    ).rejects.toThrow('Quota exceeded');
  });

  it('rolls back quota if cloudinary upload fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId: 'ws1',
      workspacePlan: 'FREE',
    });

    (checkAndConsumeUploadQuota as any).mockResolvedValue({
      allowed: true,
    });

    (cloudinary.uploader.upload as any).mockRejectedValue(
      new Error('upload failed'),
    );

    await expect(
      AttachmentMutation.addAttachment({
        userId: 'user1',
        taskId: 'task1',
        file: {
          buffer: Buffer.from('x'),
          mimetype: 'text/plain',
          originalname: 'a.txt',
          size: 100,
        } as any,
      }),
    ).rejects.toThrow('upload failed');

    expect(rollbackUploadQuota).toHaveBeenCalled();
  });

  it('fails gracefully when DB insert fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId: 'ws1',
      workspacePlan: 'FREE',
    });

    (checkAndConsumeUploadQuota as any).mockResolvedValue({
      allowed: true,
    });

    (cloudinary.uploader.upload as any).mockResolvedValue({
      public_id: 'file_123',
      bytes: 1000,
      secure_url: 'https://file.url',
      thumbnail_url: null,
    });

    (prisma.file.create as any).mockRejectedValue(new Error('db error'));

    await expect(
      AttachmentMutation.addAttachment({
        userId: 'user1',
        taskId: 'task1',
        file: {
          buffer: Buffer.from('x'),
          mimetype: 'text/plain',
          originalname: 'a.txt',
          size: 100,
        } as any,
      }),
    ).rejects.toThrow('db error');
  });

  /* ───────────────────────────────
     DELETE ATTACHMENT
  ─────────────────────────────── */

  it('deletes file successfully (idempotent safe)', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue({
      id: 'file1',
      name: 'cloudinary_id',
      size: 100,
      workspaceId: 'ws1',
      taskId: 'task1',
      originalName: 'test.txt',
    });

    (prisma.file.deleteMany as any).mockResolvedValue({ count: 1 });

    await AttachmentMutation.deleteAttachment('file1', 'user1');

    expect(prisma.file.deleteMany).toHaveBeenCalledWith({
      where: { id: 'file1' },
    });
  });

  it('handles already deleted file safely', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue({
      id: 'file1',
      name: 'cloudinary_id',
      size: 100,
      workspaceId: 'ws1',
      taskId: 'task1',
      originalName: 'test.txt',
    });

    (prisma.file.deleteMany as any).mockResolvedValue({ count: 0 });

    await AttachmentMutation.deleteAttachment('file1', 'user1');

    expect(prisma.file.deleteMany).toHaveBeenCalled();
  });

  it('throws if user has no permission', async () => {
    (AttachmentAccess.assertCanDelete as any).mockRejectedValue(
      new Error('not allowed'),
    );

    await expect(
      AttachmentMutation.deleteAttachment('file1', 'user1'),
    ).rejects.toThrow('not allowed');
  });
});