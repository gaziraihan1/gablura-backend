// src/tests/unit/attachment/attachment.service.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for AttachmentService — all external I/O is mocked.
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

// ── Repository ───────────────────────────────────────────────────────────────
// Note: AttachmentService imports AttachmentRepository internally, so we need to mock it
// at the module level before importing AttachmentService
const mockAttachmentRepository = {
  aggregateWorkspaceSize: vi.fn().mockResolvedValue({ _sum: { size: 0 } }),
  createFile:            vi.fn(),
  deleteFile:             vi.fn(),
  createActivity:         vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../../modules/attachment/attachment.repository.js', () => ({
  AttachmentRepository: mockAttachmentRepository,
}));

// ── Storage provider ──────────────────────────────────────────────────────────
vi.mock('../../../modules/attachment/storage.provider.js', () => ({
  StorageProvider: {
    upload:  vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
}));
import { StorageProvider } from '../../../modules/attachment/storage.provider.js';

import { AttachmentService } from '../../../modules/attachment/attachment.service.js';

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
  mockAttachmentRepository.aggregateWorkspaceSize.mockResolvedValue({ _sum: { size: 0 } });
  (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
  (StorageProvider.upload as any).mockResolvedValue(CLOUDINARY_RESULT);
  mockAttachmentRepository.createFile.mockResolvedValue(DB_FILE);
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AttachmentService.addAttachment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uploads file and returns the DB record', async () => {
    mockHappyPath();

    const result = await AttachmentService.addAttachment(BASE_INPUT);

    expect(result.originalName).toBe('test.txt');
    expect(StorageProvider.upload).toHaveBeenCalled();
    expect(mockAttachmentRepository.createFile).toHaveBeenCalled();
  });

  it('passes correct data to StorageProvider.upload (base64 dataURI)', async () => {
    mockHappyPath();

    await AttachmentService.addAttachment(BASE_INPUT);

    const uploadCalls = (StorageProvider.upload as any).mock.calls;
    expect(uploadCalls.length).toBeGreaterThan(0);
    const [dataURI] = uploadCalls[0];
    expect(dataURI).toMatch(/^data:text\/plain;base64,/);
  });

  it('ensures storage is seeded before upload', async () => {
    mockHappyPath();

    await AttachmentService.addAttachment(BASE_INPUT);

    expect(mockAttachmentRepository.aggregateWorkspaceSize).toHaveBeenCalledWith('ws1');
  });

  it('increments workspace storage after a successful upload (fire-and-forget)', async () => {
    mockHappyPath();

    await AttachmentService.addAttachment(BASE_INPUT);

    // Give the fire-and-forget microtask a tick to run
    await Promise.resolve();

    expect(incrementWorkspaceStorage).toHaveBeenCalledWith('ws1', CLOUDINARY_RESULT.bytes);
  });

  it('creates activity log after successful upload (fire-and-forget)', async () => {
    mockHappyPath();

    await AttachmentService.addAttachment(BASE_INPUT);

    // Give the fire-and-forget microtask a tick to run
    await Promise.resolve();

    expect(mockAttachmentRepository.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     'UPLOADED',
        entityType: 'FILE',
        entityId:   DB_FILE.id,
        userId:     'user1',
        workspaceId: 'ws1',
        taskId:     'task1',
      }),
    );
  });

  it('throws error with code when quota check returns allowed: false', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    mockAttachmentRepository.aggregateWorkspaceSize.mockResolvedValue({ _sum: { size: 0 } });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({
      allowed:      false,
      reason:       'Quota exceeded',
      code:         'DAILY_LIMIT',
      retryAfterMs: 1000,
    });

    await expect(AttachmentService.addAttachment(BASE_INPUT)).rejects.toThrow();
    expect(StorageProvider.upload).not.toHaveBeenCalled();
  });

  it('rolls back quota and rethrows when StorageProvider.upload fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    mockAttachmentRepository.aggregateWorkspaceSize.mockResolvedValue({ _sum: { size: 0 } });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
    (StorageProvider.upload as any).mockRejectedValue(new Error('upload failed'));

    await expect(AttachmentService.addAttachment(BASE_INPUT)).rejects.toThrow('Failed to upload file to storage');
    expect(rollbackUploadQuota).toHaveBeenCalledWith('user1', 'ws1');
    expect(mockAttachmentRepository.createFile).not.toHaveBeenCalled();
  });

  it('rolls back quota and destroys the uploaded file when DB insert fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    mockAttachmentRepository.aggregateWorkspaceSize.mockResolvedValue({ _sum: { size: 0 } });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
    (StorageProvider.upload as any).mockResolvedValue(CLOUDINARY_RESULT);
    mockAttachmentRepository.createFile.mockRejectedValue(new Error('db error'));

    await expect(AttachmentService.addAttachment(BASE_INPUT)).rejects.toThrow('Failed to save file record');
    expect(rollbackUploadQuota).toHaveBeenCalledWith('user1', 'ws1');
    expect(StorageProvider.destroy).toHaveBeenCalledWith(CLOUDINARY_RESULT.public_id);
  });

  it('throws when assertCanAttach rejects (access denied)', async () => {
    (AttachmentAccess.assertCanAttach as any).mockRejectedValue(new Error('TASK_NOT_FOUND'));

    await expect(AttachmentService.addAttachment(BASE_INPUT)).rejects.toThrow('TASK_NOT_FOUND');
    expect(checkAndConsumeUploadQuota).not.toHaveBeenCalled();
  });

  it('does NOT roll back quota when access check itself fails', async () => {
    (AttachmentAccess.assertCanAttach as any).mockRejectedValue(new Error('no access'));

    await expect(AttachmentService.addAttachment(BASE_INPUT)).rejects.toThrow();
    expect(rollbackUploadQuota).not.toHaveBeenCalled();
  });

  it('handles attachment without taskId', async () => {
    const inputWithoutTask = { ...BASE_INPUT, taskId: undefined as any };
    (AttachmentAccess.assertCanAttach as any).mockResolvedValue({
      workspaceId:   'ws1',
      workspacePlan: 'FREE',
    });
    mockAttachmentRepository.aggregateWorkspaceSize.mockResolvedValue({ _sum: { size: 0 } });
    (checkAndConsumeUploadQuota as any).mockResolvedValue({ allowed: true });
    (StorageProvider.upload as any).mockResolvedValue(CLOUDINARY_RESULT);
    mockAttachmentRepository.createFile.mockResolvedValue(DB_FILE);

    await AttachmentService.addAttachment(inputWithoutTask);

    expect(mockAttachmentRepository.createFile).toHaveBeenCalledWith(
      expect.not.objectContaining({ taskId: expect.anything() }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AttachmentService.deleteAttachment', () => {
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
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });

    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    expect(mockAttachmentRepository.deleteFile).toHaveBeenCalledWith('file1');
    expect(StorageProvider.destroy).toHaveBeenCalledWith(FILE_RECORD.name);
  });

  it('decrements workspace storage after deletion', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });

    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    expect(decrementWorkspaceStorage).toHaveBeenCalledWith('ws1', FILE_RECORD.size);
  });

  it('creates activity log after deletion (fire-and-forget)', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });

    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    expect(mockAttachmentRepository.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     'DELETED',
        entityType: 'FILE',
        entityId:   'file1',
        userId:     'user1',
        workspaceId: 'ws1',
        taskId:     'task1',
      }),
    );
  });

  it('is a no-op (idempotent) when deleteMany returns count: 0', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 0 });

    await AttachmentService.deleteAttachment('file1', 'user1');

    // Storage and Cloudinary should NOT be touched
    await Promise.resolve(); // Allow fire-and-forget to execute
    expect(decrementWorkspaceStorage).not.toHaveBeenCalled();
    expect(StorageProvider.destroy).not.toHaveBeenCalled();
  });

  it('skips storage decrement when workspaceId is missing on the file', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue({
      ...FILE_RECORD,
      workspaceId: null,
    });
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });

    await AttachmentService.deleteAttachment('file1', 'user1');

    await Promise.resolve(); // Allow fire-and-forget to execute
    expect(decrementWorkspaceStorage).not.toHaveBeenCalled();
  });

  it('skips activity creation when workspaceId is missing', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue({
      ...FILE_RECORD,
      workspaceId: null,
    });
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });

    await AttachmentService.deleteAttachment('file1', 'user1');

    await Promise.resolve(); // Allow fire-and-forget to execute
    expect(mockAttachmentRepository.createActivity).not.toHaveBeenCalled();
  });

  it('throws when the user has no permission to delete', async () => {
    (AttachmentAccess.assertCanDelete as any).mockRejectedValue(new Error('not allowed'));

    await expect(
      AttachmentService.deleteAttachment('file1', 'user1'),
    ).rejects.toThrow('not allowed');

    expect(mockAttachmentRepository.deleteFile).not.toHaveBeenCalled();
  });

  it('handles deletion when taskId is null', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue({
      ...FILE_RECORD,
      taskId: null,
    });
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });

    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    expect(mockAttachmentRepository.createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: undefined,
      }),
    );
  });

  it('handles Cloudinary destroy errors gracefully (fire-and-forget)', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });
    (StorageProvider.destroy as any).mockRejectedValue(new Error('Cloudinary error'));

    // Should not throw despite Cloudinary error (fire-and-forget)
    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    // The operation should complete without throwing
    expect(mockAttachmentRepository.deleteFile).toHaveBeenCalled();
  });

  it('handles storage decrement errors gracefully (fire-and-forget)', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });
    (decrementWorkspaceStorage as any).mockRejectedValue(new Error('Redis error'));

    // Should not throw despite Redis error (fire-and-forget)
    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    // The operation should complete without throwing
    expect(mockAttachmentRepository.deleteFile).toHaveBeenCalled();
  });

  it('handles activity creation errors gracefully (fire-and-forget)', async () => {
    (AttachmentAccess.assertCanDelete as any).mockResolvedValue(FILE_RECORD);
    mockAttachmentRepository.deleteFile.mockResolvedValue({ count: 1 });
    mockAttachmentRepository.createActivity.mockRejectedValue(new Error('Activity error'));

    // Should not throw despite activity error (fire-and-forget)
    await AttachmentService.deleteAttachment('file1', 'user1');
    await Promise.resolve(); // Allow fire-and-forget to execute

    // The operation should complete without throwing
    expect(mockAttachmentRepository.deleteFile).toHaveBeenCalled();
  });
});
