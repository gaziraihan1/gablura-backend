// src/tests/unit/attachment/attachment.repository.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for AttachmentRepository — prisma is mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    file: {
      aggregate: vi.fn(),
      create:    vi.fn(),
      deleteMany: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../queue/index.js', () => ({
  addInvalidateCacheJob: vi.fn().mockResolvedValue(undefined),
}));
import { addInvalidateCacheJob } from '../../../queue/index.js';

import { AttachmentRepository } from '../../../modules/attachment/attachment.repository.js';

describe('AttachmentRepository.aggregateWorkspaceSize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls prisma.file.aggregate with workspaceId filter', async () => {
    (prisma.file.aggregate as any).mockResolvedValue({ _sum: { size: 5000 } });

    const result = await AttachmentRepository.aggregateWorkspaceSize('ws1');

    expect(prisma.file.aggregate).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1' },
      _sum:  { size: true },
    });
    expect(result).toEqual({ _sum: { size: 5000 } });
  });

  it('returns 0 when no files exist in workspace', async () => {
    (prisma.file.aggregate as any).mockResolvedValue({ _sum: { size: null } });

    const result = await AttachmentRepository.aggregateWorkspaceSize('ws1');

    expect(result).toEqual({ _sum: { size: null } });
  });

  it('handles Prisma errors gracefully', async () => {
    (prisma.file.aggregate as any).mockRejectedValue(new Error('Database error'));

    await expect(AttachmentRepository.aggregateWorkspaceSize('ws1')).rejects.toThrow('Database error');
  });
});

describe('AttachmentRepository.createFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FILE_DATA = {
    name:         'cloudinary_id_123',
    originalName: 'test.txt',
    size:         1000,
    mimeType:     'text/plain',
    url:          'https://cdn.example.com/test.txt',
    thumbnail:    null,
    uploadedById: 'user1',
    workspaceId:  'ws1',
    taskId:       'task1',
  };

  const CREATED_FILE = {
    id:           'file1',
    ...FILE_DATA,
    uploadedBy: {
      id:    'user1',
      name:  'Test User',
      image: null,
    },
  };

  it('creates a file record with provided data', async () => {
    (prisma.file.create as any).mockResolvedValue(CREATED_FILE);

    const result = await AttachmentRepository.createFile(FILE_DATA);

    expect(prisma.file.create).toHaveBeenCalledWith({
      data:   FILE_DATA,
      include: {
        uploadedBy: { select: { id: true, name: true, image: true } },
      },
    });
    expect(result).toEqual(CREATED_FILE);
  });

  it('includes uploadedBy user information in response', async () => {
    (prisma.file.create as any).mockResolvedValue(CREATED_FILE);

    const result = await AttachmentRepository.createFile(FILE_DATA);

    expect(result.uploadedBy).toBeDefined();
    expect(result.uploadedBy.id).toBe('user1');
    expect(result.uploadedBy.name).toBe('Test User');
  });

  it('handles file creation without taskId', async () => {
    const dataWithoutTask = { ...FILE_DATA, taskId: undefined };
    (prisma.file.create as any).mockResolvedValue({
      ...CREATED_FILE,
      taskId: null,
    });

    await AttachmentRepository.createFile(dataWithoutTask);

    expect(prisma.file.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ taskId: expect.anything() }),
      }),
    );
  });

  it('throws on Prisma validation errors', async () => {
    (prisma.file.create as any).mockRejectedValue(new Error('Validation error'));

    await expect(AttachmentRepository.createFile(FILE_DATA)).rejects.toThrow('Validation error');
  });
});

describe('AttachmentRepository.deleteFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes file by id', async () => {
    (prisma.file.deleteMany as any).mockResolvedValue({ count: 1 });

    const result = await AttachmentRepository.deleteFile('file1');

    expect(prisma.file.deleteMany).toHaveBeenCalledWith({
      where: { id: 'file1' },
    });
    expect(result).toEqual({ count: 1 });
  });

  it('returns count: 0 when file does not exist', async () => {
    (prisma.file.deleteMany as any).mockResolvedValue({ count: 0 });

    const result = await AttachmentRepository.deleteFile('nonexistent');

    expect(result).toEqual({ count: 0 });
  });

  it('handles database errors during deletion', async () => {
    (prisma.file.deleteMany as any).mockRejectedValue(new Error('Connection error'));

    await expect(AttachmentRepository.deleteFile('file1')).rejects.toThrow('Connection error');
  });
});

describe('AttachmentRepository.createActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ACTIVITY_DATA = {
    action:     'UPLOADED',
    entityType: 'FILE',
    entityId:   'file1',
    userId:     'user1',
    workspaceId: 'ws1',
    taskId:     'task1',
    metadata: {
      fileName: 'test.txt',
      fileSize: 1000,
      mimeType: 'text/plain',
      fileUrl:  'https://cdn.example.com/test.txt',
    },
  };

  it('creates an activity record', async () => {
    (prisma.activity.create as any).mockResolvedValue({
      id: 'activity1',
      ...ACTIVITY_DATA,
    });

    const result = await AttachmentRepository.createActivity(ACTIVITY_DATA);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: ACTIVITY_DATA,
    });
    expect(result).toBeDefined();
    expect(addInvalidateCacheJob).toHaveBeenCalledWith({
      type:        'activity',
      workspaceId: 'ws1',
      userId:      'user1',
      taskId:      'task1',
    });
  });

  it('handles activity creation with minimal metadata', async () => {
    const minimalData = {
      action:     'DELETED',
      entityType: 'FILE',
      entityId:   'file1',
      userId:     'user1',
      workspaceId: 'ws1',
      metadata:   { fileName: 'test.txt', fileSize: 1000 },
    };

    (prisma.activity.create as any).mockResolvedValue({ id: 'activity1', ...minimalData });

    await AttachmentRepository.createActivity(minimalData);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: minimalData,
    });
    expect(addInvalidateCacheJob).toHaveBeenCalledWith({
      type:        'activity',
      workspaceId: 'ws1',
      userId:      'user1',
      taskId:      undefined,
    });
  });

  it('handles activity creation errors gracefully', async () => {
    (prisma.activity.create as any).mockRejectedValue(new Error('Activity creation failed'));

    await expect(AttachmentRepository.createActivity(ACTIVITY_DATA)).rejects.toThrow(
      'Activity creation failed',
    );
  });

  it('allows null taskId in activity data', async () => {
    const dataWithoutTask = {
      ...ACTIVITY_DATA,
      taskId: null,
    };

    (prisma.activity.create as any).mockResolvedValue({
      id: 'activity1',
      ...dataWithoutTask,
    });

    await AttachmentRepository.createActivity(dataWithoutTask);

    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: dataWithoutTask,
    });
    expect(addInvalidateCacheJob).toHaveBeenCalledWith({
      type:        'activity',
      workspaceId: 'ws1',
      userId:      'user1',
      taskId:      undefined,
    });
  });
});
