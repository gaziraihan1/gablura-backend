// src/tests/unit/attachment/attachment.validation.test.ts
// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for AttachmentValidation (legacy DB-based validation).
// This file is kept for reference but should still have tests.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    file: {
      count:    vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));
import { prisma } from '../../../lib/prisma.js';

import { AttachmentValidation } from '../../../modules/attachment/attachment.validation.js';

describe('AttachmentValidation.canUpload (legacy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows upload when file size is within plan limits', async () => {
    (prisma.file.count as any).mockResolvedValue(0);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      4 * 1024 * 1024, // 4 MB
    );

    expect(result.allowed).toBe(true);
    expect(result.limits?.maxFileSizeMB).toBe(5);
  });

  it('rejects upload when file size exceeds plan limits', async () => {
    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      6 * 1024 * 1024, // 6 MB > 5 MB limit
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/exceeds.*5MB/);
    expect(result.limits?.maxFileSizeMB).toBe(5);
  });

  it('allows upload when daily limit not reached', async () => {
    (prisma.file.count as any).mockResolvedValue(5); // 5 uploads today

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.allowed).toBe(true);
    expect(result.currentUsage?.todayCount).toBe(5);
  });

  it('rejects upload when daily limit is reached', async () => {
    (prisma.file.count as any).mockResolvedValue(10); // At FREE limit of 10

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Daily upload limit reached/);
    expect(result.currentUsage?.todayCount).toBe(10);
  });

  it('handles unlimited daily uploads for BUSINESS plan', async () => {
    (prisma.file.count as any).mockResolvedValue(1000);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'BUSINESS',
      1024,
    );

    expect(result.allowed).toBe(true);
    expect(result.limits?.maxDailyUploads).toBeNull();
  });

  it('enforces minimum upload interval for FREE plan', async () => {
    (prisma.file.count as any).mockResolvedValue(0);
    (prisma.file.findFirst as any).mockResolvedValue({
      uploadedAt: new Date(Date.now() - 100 * 1000), // 100 seconds ago
    });

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/wait.*seconds/);
  });

  it('allows upload when minimum interval has passed', async () => {
    (prisma.file.count as any).mockResolvedValue(0);
    (prisma.file.findFirst as any).mockResolvedValue({
      uploadedAt: new Date(Date.now() - 400 * 1000), // 400 seconds ago (> 300s limit)
    });

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.allowed).toBe(true);
  });

  it('skips interval check for PRO plan (limit is 0)', async () => {
    (prisma.file.count as any).mockResolvedValue(0);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'PRO',
      1024,
    );

    expect(result.allowed).toBe(true);
    expect(prisma.file.findFirst).not.toHaveBeenCalled();
  });

  it('handles no previous upload (first upload)', async () => {
    (prisma.file.count as any).mockResolvedValue(0);
    (prisma.file.findFirst as any).mockResolvedValue(null);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.allowed).toBe(true);
  });

  it('returns correct limits for PRO plan', async () => {
    (prisma.file.count as any).mockResolvedValue(0);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'PRO',
      1024,
    );

    expect(result.limits?.maxFileSizeMB).toBe(25);
    expect(result.limits?.maxDailyUploads).toBe(100);
    expect(result.limits?.minUploadIntervalSeconds).toBe(0);
  });

  it('returns correct limits for ENTERPRISE plan', async () => {
    (prisma.file.count as any).mockResolvedValue(0);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'ENTERPRISE',
      1024,
    );

    expect(result.limits?.maxFileSizeMB).toBe(500);
    expect(result.limits?.maxDailyUploads).toBeNull();
    expect(result.limits?.minUploadIntervalSeconds).toBe(0);
  });

  it('includes last upload time in result when interval check runs', async () => {
    (prisma.file.count as any).mockResolvedValue(0);
    const lastUploadTime = new Date(Date.now() - 200 * 1000);
    (prisma.file.findFirst as any).mockResolvedValue({
      uploadedAt: lastUploadTime,
    });

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.currentUsage?.lastUploadAt).toEqual(lastUploadTime);
  });

  it('calculates correct wait time for interval violation', async () => {
    (prisma.file.count as any).mockResolvedValue(0);
    (prisma.file.findFirst as any).mockResolvedValue({
      uploadedAt: new Date(Date.now() - 250 * 1000), // 250 seconds ago, need 300
    });

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'FREE',
      1024,
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/wait.*50.*seconds/); // 300 - 250 = 50
  });

  it('handles ENTERPRISE plan with large file sizes', async () => {
    (prisma.file.count as any).mockResolvedValue(0);

    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'ENTERPRISE',
      400 * 1024 * 1024, // 400 MB
    );

    expect(result.allowed).toBe(true);
    expect(result.limits?.maxFileSizeMB).toBe(500);
  });

  it('rejects large file on ENTERPRISE plan over limit', async () => {
    const result = await AttachmentValidation.canUpload(
      'user1',
      'ws1',
      'ENTERPRISE',
      600 * 1024 * 1024, // 600 MB > 500 MB limit
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/exceeds.*500MB/);
  });
});
