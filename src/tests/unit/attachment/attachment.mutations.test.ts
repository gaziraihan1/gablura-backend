// src/tests/unit/attachment/attachment.mutation.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for AttachmentMutation — all external I/O is mocked.
// The existing tests are kept and extended with missing coverage.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Prisma ────────────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    file: {
      aggregate:  vi.fn().mockResolvedValue({ _sum: { size: 0 } }),
      create:     vi.fn(),
      deleteMany: vi.fn(),
    },
    activity: {
      create: vi.fn().mockResolvedValue(true),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

// ── Cloudinary ────────────────────────────────────────────────────────────────
vi.mock('cloudinary', () => ({
  v2: {
    config:   vi.fn(),
    uploader: {
      upload:  vi.fn(),
      destroy: vi.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));
import { v2 as cloudinary } from 'cloudinary';

// ── Quota service ─────────────────────────────────────────────────────────────
vi.mock('../../../modules/attachment/attatchment.quota.service.js', () => ({
  checkAndConsumeUploadQuota: vi.fn(),
  rollbackUploadQuota:        vi.fn().mockResolvedValue(undefined),
  incrementWorkspaceStorage:  vi.fn().mockResolvedValue(undefined),
  decrementWorkspaceStorage:  vi.fn().mockResolvedValue(undefined),
  seedWorkspaceStorageFromDb: vi.fn().mockResolvedValue(undefined),
}));
import {
  checkAndConsumeUploadQuota,
  rollbackUploadQuota,
  incrementWorkspaceStorage,
  decrementWorkspaceStorage,
} from '../../../modules/attachment/attatchment.quota.service.js';

// ── Access ────────────────────────────────────────────────────────────────────
vi.mock('../../../modules/attachment/attachment.access.js', () => ({
  AttachmentAccess: {
    assertCanAttach: vi.fn(),
    assertCanDelete: vi.fn(),
  },
}));
import { AttachmentAccess } from '../../../modules/attachment/attachment.access.js';

// ── Storage provider ──────────────────────────────────────────────────────────
vi.mock('../../../modules/attachment/storage.provider.js', () => ({
  StorageProvider: {
    upload:  vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
}));
import { StorageProvider } from '../../../modules/attachment/storage.provider.js';

import { AttachmentMutation } from '../../../modules/attachment/attachment.mutation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shared test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const BASE_INPUT = {
  userId: 'user1',
  taskId: 'task1',
  file: {
    buffer:       Buffer.from('hello'),
    mimetype:     'text/plain',
    originalname: 'test.txt',
    size:         1000,
  } as any,
};

const CLOUDINARY_RESULT = {
  public_id:     'file_123',
  bytes:         1000,
  secure_url:    'https://cdn.example.com/file.txt',
  thumbnail_url: null,
};

const DB_FILE = {
  id:           'file_db_1',
  originalName: 'test.txt',
  size:         1000,
  url:          'https://cdn.example.com/file.txt',
  mimeType:     'text/plain',
};

function mockHappyPath() {
  (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
    workspaceId:   'ws1',
    workspacePlan: 'FREE',
  });
  (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
  (StorageProvider.upload as any).mockResolvedValue(CLOUDINARY_RESULT);
  (prisma.file.create as any).mockResolvedValue(DB_FILE);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AttachmentMutation.addAttachment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads file and returns the DB record', async () => {
    mockHappyPath();

    const result = await AttachmentMutation.addAttachment(BASE_INPUT);

    expect(result.originalName).toBe('test.txt');
    expect(StorageProvider.upload).toHaveBeenCalledOnce();
    expect(prisma.file.create).toHaveBeenCalledOnce();
  });

  it('passes correct data to StorageProvider.upload (base64 dataURI)', async () => {
    mockHappyPath();

    await AttachmentMutation.addAttachment(BASE_INPUT);

    const [dataURI] = (StorageProvider.upload as any).mock.calls[0];
    expect(dataURI).toMatch(/^data:text\/plain;base64,/);
  });

  it('increments workspace storage after a successful upload (fire-and-forget)', async () => {
    mockHappyPath();

    await AttachmentMutation.addAttachment(BASE_INPUT);

    // Give the fire-and-forget microtask a tick to run
    await Promise.resolve();

    expect(incrementWorkspaceStorage).toHaveBeenCalledWith('ws1', CLOUDINARY_RESULT.bytes);
  });

  it('throws QuotaError when quota check returns allowed: false', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({
      allowed:      false,
      reason:       'Quota exceeded',
      code:         'DAILY_LIMIT',
      retryAfterMs: 1000,
    });

    await expect(AttachmentMutation.addAttachment(BASE_INPUT)).rejects.toThrow('Quota exceeded');
    expect(StorageProvider.upload).not.toHaveBeenCalled();
  });

  it('rolls back quota and rethrows when StorageProvider.upload fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
    (StorageProvider.upload as any).mockRejectedValue(new Error('upload failed'));

    await expect(AttachmentMutation.addAttachment(BASE_INPUT)).rejects.toThrow('upload failed');
    expect(rollbackUploadQuota).toHaveBeenCalledWith('user1', 'ws1');
    expect(prisma.file.create).not.toHaveBeenCalled();
  });

  it('rolls back quota and destroys the uploaded file when DB insert fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
    (StorageProvider.upload as any).mockResolvedValue(CLOUDINARY_RESULT);
    (prisma.file.create as any).mockRejectedValue(new Error('db error'));

    await expect(AttachmentMutation.addAttachment(BASE_INPUT)).rejects.toThrow('db error');
    expect(rollbackUploadQuota).toHaveBeenCalledWith('user1', 'ws1');
    expect(StorageProvider.destroy).toHaveBeenCalledWith(CLOUDINARY_RESULT.public_id);
  });

  it('throws when assertCanAttach rejects (access denied)', async () => {
    (AttachmentAccess.assertCanAttach as any).mockRejectedValue(new Error('TASK_NOT_FOUND'));

    await expect(AttachmentMutation.addAttachment(BASE_INPUT)).rejects.toThrow('TASK_NOT_FOUND');
    expect(checkAndConsumeUploadQuota).not.toHaveBeenCalled();
  });

  it('does NOT roll back quota when access check itself fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockRejectedValue(new Error('no access'));

    await expect(AttachmentMutation.addAttachment(BASE_INPUT)).rejects.toThrow();
    expect(rollbackUploadQuota).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AttachmentMutation.deleteAttachment', () => {
  beforeEach(() => vi.clearAllMocks());

  const FILE_RECORD = {
    id:           'file1',
    name:         'cloudinary_id_abc',
    size:         500,
    workspaceId:  'ws1',
    taskId:       'task1',
    originalName: 'test.txt',
  };

  it('deletes the file record and triggers Cloudinary destroy', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    (prisma.file.deleteMany as any).mockResolvedValue({ count: 1 });

    await AttachmentMutation.deleteAttachment('file1', 'user1');

    expect(prisma.file.deleteMany).toHaveBeenCalledWith({ where: { id: 'file1' } });
    // fire-and-forget, but mock is synchronous so it will have been called
    expect(StorageProvider.destroy).toHaveBeenCalledWith(FILE_RECORD.name);
  });

  it('decrements workspace storage after deletion', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    (prisma.file.deleteMany as any).mockResolvedValue({ count: 1 });

    await AttachmentMutation.deleteAttachment('file1', 'user1');

    expect(decrementWorkspaceStorage).toHaveBeenCalledWith('ws1', FILE_RECORD.size);
  });

  it('is a no-op (idempotent) when deleteMany returns count: 0', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    (prisma.file.deleteMany as any).mockResolvedValue({ count: 0 });

    await AttachmentMutation.deleteAttachment('file1', 'user1');

    // Storage and Cloudinary should NOT be touched
    expect(decrementWorkspaceStorage).not.toHaveBeenCalled();
    expect(StorageProvider.destroy).not.toHaveBeenCalled();
  });

  it('skips storage decrement when workspaceId is missing on the file', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue({
      ...FILE_RECORD,
      workspaceId: null,
    });
    (prisma.file.deleteMany as any).mockResolvedValue({ count: 1 });

    await AttachmentMutation.deleteAttachment('file1', 'user1');

    expect(decrementWorkspaceStorage).not.toHaveBeenCalled();
  });

  it('throws when the user has no permission to delete', async () => {
    (AttachmentAccess.assertCanDelete as any).mockRejectedValue(new Error('not allowed'));

    await expect(
      AttachmentMutation.deleteAttachment('file1', 'user1'),
    ).rejects.toThrow('not allowed');

    expect(prisma.file.deleteMany).not.toHaveBeenCalled();
  });
});