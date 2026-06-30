// src/tests/unit/attachment/attachment.controller.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for attachment controller functions — Express req/res are mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Prisma ────────────────────────────────────────────────────────────────────
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    workspaceMember: {
      findFirst: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
    file: {
      aggregate: vi.fn(),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

// ── Attachment modules ────────────────────────────────────────────────────────
vi.mock('../../../modules/attachment/attachment.query.js', () => ({
  AttachmentQuery: {
    getTaskAttachments:           vi.fn(),
    getWorkspaceAttachmentStats: vi.fn(),
  },
}));
import { AttachmentQuery } from '../../../modules/attachment/attachment.query.js';

vi.mock('../../../modules/attachment/attachment.mutation.js', () => ({
  AttachmentMutation: {
    addAttachment:    vi.fn(),
    deleteAttachment: vi.fn(),
  },
}));
import { AttachmentMutation } from '../../../modules/attachment/attachment.mutation.js';

vi.mock('../../../modules/attachment/attatchment.quota.service.js', () => ({
  getStorageInfo:           vi.fn(),
  seedWorkspaceStorageFromDb: vi.fn(),
}));
import {
  getStorageInfo,
  seedWorkspaceStorageFromDb,
} from '../../../modules/attachment/attatchment.quota.service.js';

// ── Express types ─────────────────────────────────────────────────────────────
import type { Response } from 'express';
import type { AuthRequest } from '../../../middleware/auth.js';

import {
  getTaskAttachments,
  addAttachment,
  deleteAttachment,
  getAttachmentStats,
  getWorkspaceStorage,
} from '../../../modules/attachment/attachment.controller.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mock helpers
// ─────────────────────────────────────────────────────────────────────────────

function mockRequest(params: any = {}, user: any = { id: 'user1', email: 'test@example.com', role: 'MEMBER' }, file: any = null): AuthRequest {
  return {
    params,
    user,
    file,
  } as any;
}

// Return a loosely typed mock response that includes the Express Response methods
// and a `next` mock function. Using `any` avoids TypeScript's strict `Response`
// definition which does not contain a `next` property.
function mockResponse(): any {
  const res: any = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    // `next` is typically a separate argument to the controller, but the tests
    // historically passed `res.next`. Declaring it here keeps the existing test
    // calls unchanged while satisfying the type checker.
    next: vi.fn(),
  };
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('getTaskAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns task attachments successfully', async () => {
    const attachments = [
      { id: 'f1', originalName: 'test.txt' },
      { id: 'f2', originalName: 'image.png' },
    ];

    (AttachmentQuery.getTaskAttachments as any).mockResolvedValue(attachments);

    const req = mockRequest({ taskId: 'task1' });
    const res = mockResponse();

    await getTaskAttachments(req, res, res.next);

    expect(AttachmentQuery.getTaskAttachments).toHaveBeenCalledWith('task1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data:    attachments,
    });
  });

  it('returns empty array when no attachments exist', async () => {
    (AttachmentQuery.getTaskAttachments as any).mockResolvedValue([]);

    const req = mockRequest({ taskId: 'task1' });
    const res = mockResponse();

    await getTaskAttachments(req, res, res.next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data:    [],
    });
  });

  it('passes userId from authenticated user', async () => {
    (AttachmentQuery.getTaskAttachments as any).mockResolvedValue([]);

    const req = mockRequest({ taskId: 'task1' }, { id: 'user123' });
    const res = mockResponse();

    await getTaskAttachments(req, res, res.next);

    expect(AttachmentQuery.getTaskAttachments).toHaveBeenCalledWith('task1', 'user123');
  });
});

describe('addAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads file successfully and returns 201', async () => {
    const file = {
      originalname: 'test.txt',
      mimetype:     'text/plain',
      size:         1000,
      buffer:       Buffer.from('hello'),
    };

    const uploadedFile = {
      id:           'file1',
      originalName: 'test.txt',
      url:          'https://cdn.example.com/test.txt',
    };

    (AttachmentMutation.addAttachment as any).mockResolvedValue(uploadedFile);

    const req = mockRequest({ taskId: 'task1' }, { id: 'user1' }, file);
    const res = mockResponse();

    await addAttachment(req, res, res.next);

    expect(AttachmentMutation.addAttachment).toHaveBeenCalledWith({
      taskId: 'task1',
      userId: 'user1',
      file:   file,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data:    uploadedFile,
      message: 'File uploaded successfully',
    });
  });

  it('throws BadRequestError when no file is provided', async () => {
    const req = mockRequest({ taskId: 'task1' }, { id: 'user1' }, null);
    const res = mockResponse();

    await addAttachment(req, res, res.next);

    expect(res.next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No file provided' })
    );
  });

  it('passes correct file metadata to mutation', async () => {
    const file = {
      originalname: 'document.pdf',
      mimetype:     'application/pdf',
      size:         5000,
      buffer:       Buffer.from('pdf content'),
    };

    (AttachmentMutation.addAttachment as any).mockResolvedValue({ id: 'file1' });

    const req = mockRequest({ taskId: 'task1' }, { id: 'user1' }, file);
    const res = mockResponse();

    await addAttachment(req, res, res.next);

    expect(AttachmentMutation.addAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          originalname: 'document.pdf',
          mimetype:     'application/pdf',
          size:         5000,
        }),
      }),
    );
  });
});

describe('deleteAttachment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes attachment successfully', async () => {
    (AttachmentMutation.deleteAttachment as any).mockResolvedValue(undefined);

    const req = mockRequest({ attachmentId: 'file1' }, { id: 'user1' });
    const res = mockResponse();

    await deleteAttachment(req, res, res.next);

    expect(AttachmentMutation.deleteAttachment).toHaveBeenCalledWith('file1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: 'Attachment deleted successfully',
    });
  });

  it('passes userId from authenticated user', async () => {
    (AttachmentMutation.deleteAttachment as any).mockResolvedValue(undefined);

    const req = mockRequest({ attachmentId: 'file1' }, { id: 'user123' });
    const res = mockResponse();

    await deleteAttachment(req, res, res.next);

    expect(AttachmentMutation.deleteAttachment).toHaveBeenCalledWith('file1', 'user123');
  });
});

describe('getAttachmentStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace attachment stats successfully', async () => {
    const stats = {
      totalFiles:  10,
      totalSizeMB: 5.5,
      storage: {
        usedBytes:  5.5 * 1024 * 1024,
        maxBytes:   10 * 1024 * 1024 * 1024,
        usedPct:    0.05,
        isNearLimit: false,
        isFull:     false,
      },
      userUploads: [],
    };

    (AttachmentQuery.getWorkspaceAttachmentStats as any).mockResolvedValue(stats);

    const req = mockRequest({ workspaceId: 'ws1' }, { id: 'user1' });
    const res = mockResponse();

    await getAttachmentStats(req, res, res.next);

    expect(AttachmentQuery.getWorkspaceAttachmentStats).toHaveBeenCalledWith('ws1', 'user1');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data:    stats,
    });
  });

  it('passes workspaceId and userId to query', async () => {
    (AttachmentQuery.getWorkspaceAttachmentStats as any).mockResolvedValue({});

    const req = mockRequest({ workspaceId: 'ws123' }, { id: 'user456' });
    const res = mockResponse();

    await getAttachmentStats(req, res, res.next);

    expect(AttachmentQuery.getWorkspaceAttachmentStats).toHaveBeenCalledWith('ws123', 'user456');
  });
});

describe('getWorkspaceStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace storage info for member', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: 'member1' });
    (prisma.workspace.findUnique as any).mockResolvedValue({ plan: 'PRO' });
    (prisma.file.aggregate as any).mockResolvedValue({ _sum: { size: 1000 } });
    (seedWorkspaceStorageFromDb as any).mockResolvedValue(undefined);
    (getStorageInfo as any).mockResolvedValue({
      usedBytes:     1000,
      maxBytes:      10 * 1024 * 1024 * 1024,
      remainingBytes: 9999,
      usedPct:       0.01,
      usedFormatted: '1000 B',
      maxFormatted:  '10 GB',
      isNearLimit:   false,
      isFull:        false,
    });

    const req = mockRequest({ workspaceId: 'ws1' }, { id: 'user1' });
    const res = mockResponse();

    await getWorkspaceStorage(req, res, res.next);

    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws1', userId: 'user1' },
    });
    expect(getStorageInfo).toHaveBeenCalledWith('ws1', 'PRO');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data:    expect.objectContaining({
        usedBytes: 1000,
      }),
    });
  });

  it('throws ForbiddenError when user is not a workspace member', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue(null);

    const req = mockRequest({ workspaceId: 'ws1' }, { id: 'user1' });
    const res = mockResponse();

    await getWorkspaceStorage(req, res, res.next);

    expect(res.next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Not a workspace member' })
    );
  });

  it('defaults to FREE plan when workspace plan is missing', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: 'member1' });
    (prisma.workspace.findUnique as any).mockResolvedValue({ plan: null });
    (prisma.file.aggregate as any).mockResolvedValue({ _sum: { size: 0 } });
    (seedWorkspaceStorageFromDb as any).mockResolvedValue(undefined);
    (getStorageInfo as any).mockResolvedValue({
      usedBytes: 0,
      maxBytes:  1 * 1024 * 1024 * 1024,
    });

    const req = mockRequest({ workspaceId: 'ws1' }, { id: 'user1' });
    const res = mockResponse();

    await getWorkspaceStorage(req, res, res.next);

    expect(getStorageInfo).toHaveBeenCalledWith('ws1', 'FREE');
  });

  it('seeds storage from DB before returning info', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: 'member1' });
    (prisma.workspace.findUnique as any).mockResolvedValue({ plan: 'PRO' });
    (prisma.file.aggregate as any).mockResolvedValue({ _sum: { size: 5000 } });
    (seedWorkspaceStorageFromDb as any).mockResolvedValue(undefined);
    (getStorageInfo as any).mockResolvedValue({ usedBytes: 5000 });

    const req = mockRequest({ workspaceId: 'ws1' }, { id: 'user1' });
    const res = mockResponse();

    await getWorkspaceStorage(req, res, res.next);

    expect(seedWorkspaceStorageFromDb).toHaveBeenCalledWith('ws1', 5000);
  });

  it('handles zero storage usage', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue({ id: 'member1' });
    (prisma.workspace.findUnique as any).mockResolvedValue({ plan: 'FREE' });
    (prisma.file.aggregate as any).mockResolvedValue({ _sum: { size: null } });
    (seedWorkspaceStorageFromDb as any).mockResolvedValue(undefined);
    (getStorageInfo as any).mockResolvedValue({ usedBytes: 0 });

    const req = mockRequest({ workspaceId: 'ws1' }, { id: 'user1' });
    const res = mockResponse();

    await getWorkspaceStorage(req, res, res.next);

    expect(seedWorkspaceStorageFromDb).toHaveBeenCalledWith('ws1', 0);
  });
});
