// src/tests/unit/attachment/attachment.access.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for AttachmentAccess — prisma is mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
    },
    file: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

import { AttachmentAccess } from '../../../modules/attachment/attachment.access.js';

describe('AttachmentAccess.assertCanAttach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows task creator to attach files', async () => {
    (prisma.task.findFirst as any).mockResolvedValue({
      id: 'task1',
      project: {
        workspaceId: 'ws1',
        workspace: {
          id: 'ws1',
          plan: 'PRO',
          members: [{ role: 'MEMBER' }],
        },
      },
    });

    const result = await AttachmentAccess.assertCanAttach('task1', 'user1');

    expect(result.workspaceId).toBe('ws1');
    expect(result.workspacePlan).toBe('PRO');
    expect(result.userRole).toBe('MEMBER');
  });

  it('allows task assignee to attach files', async () => {
    (prisma.task.findFirst as any).mockResolvedValue({
      id: 'task1',
      project: {
        workspaceId: 'ws1',
        workspace: {
          id: 'ws1',
          plan: 'FREE',
          members: [{ role: 'MEMBER' }],
        },
      },
    });

    const result = await AttachmentAccess.assertCanAttach('task1', 'user1');

    expect(result.workspaceId).toBe('ws1');
    expect(result.workspacePlan).toBe('FREE');
  });

  it('allows workspace member to attach files', async () => {
    (prisma.task.findFirst as any).mockResolvedValue({
      id: 'task1',
      project: {
        workspaceId: 'ws1',
        workspace: {
          id: 'ws1',
          plan: 'BUSINESS',
          members: [{ role: 'ADMIN' }],
        },
      },
    });

    const result = await AttachmentAccess.assertCanAttach('task1', 'user1');

    expect(result.workspaceId).toBe('ws1');
    expect(result.workspacePlan).toBe('BUSINESS');
    expect(result.userRole).toBe('ADMIN');
  });

  it('throws NotFoundError when task does not exist', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(null);

    await expect(AttachmentAccess.assertCanAttach('task1', 'user1')).rejects.toThrow('Task not found');
  });

  it('throws BadRequestError for personal tasks (no workspace)', async () => {
    (prisma.task.findFirst as any).mockResolvedValue({
      id: 'task1',
      project: {
        workspaceId: null,
      },
    });

    await expect(AttachmentAccess.assertCanAttach('task1', 'user1')).rejects.toThrow(
      'Personal tasks cannot have attachments',
    );
  });

  it('throws NotFoundError when user is not task creator, assignee, or workspace member', async () => {
    (prisma.task.findFirst as any).mockResolvedValue(null);

    await expect(AttachmentAccess.assertCanAttach('task1', 'user1')).rejects.toThrow('Task not found');
  });

  it('defaults to FREE plan when workspace plan is missing', async () => {
    (prisma.task.findFirst as any).mockResolvedValue({
      id: 'task1',
      project: {
        workspaceId: 'ws1',
        workspace: {
          id: 'ws1',
          plan: null,
          members: [{ role: 'MEMBER' }],
        },
      },
    });

    const result = await AttachmentAccess.assertCanAttach('task1', 'user1');

    expect(result.workspacePlan).toBe('FREE');
  });
});

describe('AttachmentAccess.assertCanDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const FILE_RECORD = {
    id: 'file1',
    name: 'cloudinary_id',
    originalName: 'test.txt',
    size: 1000,
    taskId: 'task1',
    uploadedById: 'user1',
    workspaceId: 'ws1',
    workspace: {
      members: [{ role: 'MEMBER' }],
    },
  };

  it('allows file uploader to delete', async () => {
    (prisma.file.findFirst as any).mockResolvedValue(FILE_RECORD);

    const result = await AttachmentAccess.assertCanDelete('file1', 'user1');

    expect(result.id).toBe('file1');
    expect(result.uploadedById).toBe('user1');
  });

  it('allows workspace OWNER to delete any file', async () => {
    (prisma.file.findFirst as any).mockResolvedValue({
      ...FILE_RECORD,
      uploadedById: 'user2',
      workspace: {
        members: [{ role: 'OWNER' }],
      },
    });

    const result = await AttachmentAccess.assertCanDelete('file1', 'user1');

    expect(result.id).toBe('file1');
  });

  it('allows workspace ADMIN to delete any file', async () => {
    (prisma.file.findFirst as any).mockResolvedValue({
      ...FILE_RECORD,
      uploadedById: 'user2',
      workspace: {
        members: [{ role: 'ADMIN' }],
      },
    });

    const result = await AttachmentAccess.assertCanDelete('file1', 'user1');

    expect(result.id).toBe('file1');
  });

  it('throws NotFoundError when file does not exist', async () => {
    (prisma.file.findFirst as any).mockResolvedValue(null);

    await expect(AttachmentAccess.assertCanDelete('file1', 'user1')).rejects.toThrow('File');
  });

  it('throws ForbiddenError when user is neither uploader nor admin', async () => {
    (prisma.file.findFirst as any).mockResolvedValue({
      ...FILE_RECORD,
      uploadedById: 'user2',
      workspace: {
        members: [{ role: 'MEMBER' }],
      },
    });

    await expect(AttachmentAccess.assertCanDelete('file1', 'user1')).rejects.toThrow(
      'You do not have permission to delete this file',
    );
  });

  it('throws ForbiddenError when user has no role in workspace', async () => {
    (prisma.file.findFirst as any).mockResolvedValue({
      ...FILE_RECORD,
      uploadedById: 'user2',
      workspace: {
        members: [],
      },
    });

    await expect(AttachmentAccess.assertCanDelete('file1', 'user1')).rejects.toThrow(
      'You do not have permission to delete this file',
    );
  });
});

describe('AttachmentAccess.assertCanViewStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows workspace OWNER to view stats', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue({
      role: 'OWNER',
    });

    await expect(AttachmentAccess.assertCanViewStats('ws1', 'user1')).resolves.not.toThrow();
  });

  it('allows workspace ADMIN to view stats', async () => {
    (prisma.workspaceMember.findFirst as any).mockResolvedValue({
      role: 'ADMIN',
    });

    await expect(AttachmentAccess.assertCanViewStats('ws1', 'user1')).resolves.not.toThrow();
  });

  it('throws ForbiddenError for regular MEMBER', async () => {
    // The query checks for role in ['OWNER', 'ADMIN'], so MEMBER won't match
    (prisma.workspaceMember.findFirst as any).mockResolvedValue(null);

    await expect(AttachmentAccess.assertCanViewStats('ws1', 'user1')).rejects.toThrow(
      'Only workspace owners and admins can view attachment statistics',
    );
  });
});
