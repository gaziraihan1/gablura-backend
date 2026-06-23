// src/tests/unit/attachment/attachment.utils.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Pure-function tests for attachment.utils.ts — no mocks needed.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  getLimitsForPlan,
  bytesToMB,
  getTodayStart,
  getTodayEnd,
} from '../../../modules/attachment/attachment.utils.js';

describe('getLimitsForPlan', () => {
  it('returns FREE limits for FREE plan', () => {
    const l = getLimitsForPlan('FREE');
    expect(l.maxFileSizeMB).toBe(5);
    expect(l.maxDailyUploads).toBe(10);
    expect(l.minUploadIntervalSeconds).toBe(300);
  });

  it('returns PRO limits', () => {
    const l = getLimitsForPlan('PRO');
    expect(l.maxFileSizeMB).toBe(25);
    expect(l.maxDailyUploads).toBe(100);
    expect(l.minUploadIntervalSeconds).toBe(0);
  });

  it('returns BUSINESS limits (null daily uploads = unlimited)', () => {
    const l = getLimitsForPlan('BUSINESS');
    expect(l.maxFileSizeMB).toBe(100);
    expect(l.maxDailyUploads).toBeNull();
  });

  it('returns ENTERPRISE limits (500 MB, null daily)', () => {
    const l = getLimitsForPlan('ENTERPRISE');
    expect(l.maxFileSizeMB).toBe(500);
    expect(l.maxDailyUploads).toBeNull();
  });

  it('falls back to FREE for an unknown plan', () => {
    const l = getLimitsForPlan('UNKNOWN');
    expect(l.maxFileSizeMB).toBe(5);
  });
});

describe('bytesToMB', () => {
  it('converts 0 bytes to 0 MB', () => {
    expect(bytesToMB(0)).toBe(0);
  });

  it('converts exactly 1 MB (1048576 bytes)', () => {
    expect(bytesToMB(1048576)).toBe(1);
  });

  it('rounds to 2 decimal places', () => {
    // 1.5 MB = 1572864 bytes
    expect(bytesToMB(1572864)).toBe(1.5);
  });

  it('handles large values (100 MB)', () => {
    expect(bytesToMB(100 * 1024 * 1024)).toBe(100);
  });

  it('rounds correctly for non-integer results', () => {
    // 1234567 bytes ≈ 1.18 MB
    const result = bytesToMB(1234567);
    expect(result).toBeCloseTo(1.18, 1);
  });
});

describe('getTodayStart', () => {
  it('returns a Date with time set to 00:00:00.000', () => {
    const start = getTodayStart();
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
  });

  it('returns today\'s date', () => {
    const start = getTodayStart();
    const now   = new Date();
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth());
    expect(start.getDate()).toBe(now.getDate());
  });
});

describe('getTodayEnd', () => {
  it('returns a Date with time set to 23:59:59.999', () => {
    const end = getTodayEnd();
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it('getTodayStart is before getTodayEnd', () => {
    expect(getTodayStart().getTime()).toBeLessThan(getTodayEnd().getTime());
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// src/tests/unit/attachment/attachment.query.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for AttachmentQuery — prisma and external services are mocked.
// ─────────────────────────────────────────────────────────────────────────────

import { vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    file: {
      findMany:  vi.fn(),
      aggregate: vi.fn().mockResolvedValue({ _sum: { size: 0 } }),
    },
    workspace: {
      findUnique: vi.fn().mockResolvedValue({ plan: 'PRO' }),
    },
  },
}));
import { prisma as prismaMock } from '../../../lib/prisma.js';

vi.mock('../../../modules/attachment/attachment.access.js', () => ({
  AttachmentAccess: {
    assertCanAttach:   vi.fn().mockResolvedValue({ workspaceId: 'ws1', workspacePlan: 'PRO' }),
    assertCanViewStats: vi.fn().mockResolvedValue(undefined),
  },
}));
import { AttachmentAccess } from '../../../modules/attachment/attachment.access.js';

vi.mock('../../../modules/attachment/attatchment.quota.service.js', () => ({
  seedWorkspaceStorageFromDb: vi.fn().mockResolvedValue(undefined),
  getStorageInfo: vi.fn().mockResolvedValue({
    usedBytes:      1000,
    maxBytes:       10 * 1024 * 1024 * 1024,
    remainingBytes: 9999,
    usedPct:        0.01,
    usedFormatted:  '1000 B',
    maxFormatted:   '10 GB',
    isNearLimit:    false,
    isFull:         false,
    limits: {
      maxFileSizeBytes:       25 * 1024 * 1024,
      maxDailyUploadsPerUser: 100,
      uploadsPerMinute:       10,
      uploadsPerHour:         60,
    },
  }),
}));

import { AttachmentQuery } from '../../../modules/attachment/attachment.query.js';

describe('AttachmentQuery.getTaskAttachments', () => {
  beforeEach(() => vi.clearAllMocks());

  const FILES = [
    { id: 'f1', originalName: 'a.txt', uploadedBy: { id: 'u1', name: 'Alice', image: null } },
    { id: 'f2', originalName: 'b.png', uploadedBy: { id: 'u2', name: 'Bob',   image: null } },
  ];

  it('returns files for the task ordered by uploadedAt desc', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue(FILES);

    const result = await AttachmentQuery.getTaskAttachments('task1', 'user1');

    expect(result).toEqual(FILES);
    expect(prismaMock.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { taskId: 'task1' },
        orderBy: { uploadedAt: 'desc' },
      }),
    );
  });

  it('calls assertCanAttach to enforce access', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue([]);

    await AttachmentQuery.getTaskAttachments('task1', 'user1');

    expect(AttachmentAccess.assertCanAttach).toHaveBeenCalledWith('task1', 'user1');
  });

  it('throws if assertCanAttach rejects', async () => {
    (AttachmentAccess.assertCanAttach as any).mockRejectedValueOnce(new Error('TASK_NOT_FOUND'));

    await expect(
      AttachmentQuery.getTaskAttachments('task1', 'user1'),
    ).rejects.toThrow('TASK_NOT_FOUND');

    expect(prismaMock.file.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty array when no files exist', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue([]);

    const result = await AttachmentQuery.getTaskAttachments('task1', 'user1');
    expect(result).toEqual([]);
  });
});

describe('AttachmentQuery.getWorkspaceAttachmentStats', () => {
  beforeEach(() => vi.clearAllMocks());

  const WORKSPACE_FILES = [
    { size: 500,  uploadedBy: { id: 'u1', name: 'Alice' } },
    { size: 1500, uploadedBy: { id: 'u1', name: 'Alice' } },
    { size: 2000, uploadedBy: { id: 'u2', name: 'Bob'   } },
  ];

  it('returns totalFiles count', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue(WORKSPACE_FILES);

    const stats = await AttachmentQuery.getWorkspaceAttachmentStats('ws1', 'admin1');
    expect(stats.totalFiles).toBe(3);
  });

  it('returns userUploads breakdown sorted by fileCount desc', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue(WORKSPACE_FILES);

    const stats = await AttachmentQuery.getWorkspaceAttachmentStats('ws1', 'admin1');

    expect(stats.userUploads[0].userId).toBe('u1');
    expect(stats.userUploads[0].fileCount).toBe(2);
    expect(stats.userUploads[1].userId).toBe('u2');
    expect(stats.userUploads[1].fileCount).toBe(1);
  });

  it('returns storage shape from getStorageInfo', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue([]);

    const stats = await AttachmentQuery.getWorkspaceAttachmentStats('ws1', 'admin1');

    expect(stats.storage).toBeDefined();
    expect(stats.storage.usedBytes).toBe(1000);
    expect(stats.storage.isNearLimit).toBe(false);
    expect(stats.storage.limits).toBeDefined();
  });

  it('calls assertCanViewStats to enforce admin-only access', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue([]);

    await AttachmentQuery.getWorkspaceAttachmentStats('ws1', 'admin1');

    expect(AttachmentAccess.assertCanViewStats).toHaveBeenCalledWith('ws1', 'admin1');
  });

  it('throws if assertCanViewStats rejects (non-admin)', async () => {
    (AttachmentAccess.assertCanViewStats as any).mockRejectedValueOnce(
      new Error('Only workspace owners and admins can view attachment statistics'),
    );

    await expect(
      AttachmentQuery.getWorkspaceAttachmentStats('ws1', 'member1'),
    ).rejects.toThrow('Only workspace owners');
  });

  it('handles empty file list gracefully (zero totals)', async () => {
    (prismaMock.file.findMany as any).mockResolvedValue([]);

    const stats = await AttachmentQuery.getWorkspaceAttachmentStats('ws1', 'admin1');

    expect(stats.totalFiles).toBe(0);
    expect(stats.userUploads).toEqual([]);
    expect(stats.totalSizeMB).toBe(0);
  });
});