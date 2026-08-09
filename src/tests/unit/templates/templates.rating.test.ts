/**
 * src/tests/unit/templates/templates.rating.test.ts
 *
 * M5 — template ratings. Covers TemplateMutation.rate: one rating per user,
 * aggregate recomputation, rounding, not-found guards and the P2002 race retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateMutation } from '../../../modules/templates/templates.mutation.js';
import { prisma } from '../../../lib/prisma.js';
import { NotFoundError } from '../../../errors/index.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    projectTemplate: { findUnique: vi.fn(), update: vi.fn() },
    workspace: { findMany: vi.fn() },
    workspaceMember: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

/** Builds a mock transaction client used inside $transaction. */
function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    templateRating: {
      upsert: vi.fn().mockResolvedValue({ id: 'r1' }),
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { stars: 5 }, _count: 1 }),
    },
    projectTemplate: { update: vi.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

const publicTemplate = {
  id: 'tpl1',
  tier: 'FREE',
  visibility: 'PUBLIC',
  status: 'available',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.workspace.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.workspaceMember.findMany).mockResolvedValue([] as never);
});

describe('TemplateMutation.rate', () => {
  it('creates a rating and recomputes the aggregates from the table', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      publicTemplate as never,
    );
    const tx = makeTx();
    vi.mocked(prisma.$transaction).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => fn(tx),
    );

    const result = await TemplateMutation.rate('u1', 'engineering-sprint', 5);

    expect(tx.templateRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { templateId_userId: { templateId: 'tpl1', userId: 'u1' } },
        create: { templateId: 'tpl1', userId: 'u1', stars: 5 },
        update: { stars: 5 },
      }),
    );
    expect(tx.projectTemplate.update).toHaveBeenCalledWith({
      where: { id: 'tpl1' },
      data: { ratingSum: 5, ratingCount: 1 },
    });
    expect(result).toEqual({ average: 5, count: 1 });
  });

  it('re-rating the same user replaces the previous stars', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      publicTemplate as never,
    );
    const tx = makeTx({
      templateRating: {
        upsert: vi.fn().mockResolvedValue({ id: 'r1' }),
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { stars: 3 }, _count: 1 }),
      },
    });
    vi.mocked(prisma.$transaction).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => fn(tx),
    );

    const result = await TemplateMutation.rate('u1', 'engineering-sprint', 3);

    // The same unique key means the old 5-star rating is replaced by 3.
    expect(tx.templateRating.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { stars: 3 } }),
    );
    expect(result).toEqual({ average: 3, count: 1 });
  });

  it('returns a rounded one-decimal average across multiple ratings', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      publicTemplate as never,
    );
    const tx = makeTx({
      templateRating: {
        upsert: vi.fn().mockResolvedValue({ id: 'r1' }),
        aggregate: vi
          .fn()
          .mockResolvedValue({ _sum: { stars: 48 }, _count: 10 }),
      },
    });
    vi.mocked(prisma.$transaction).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (fn: any) => fn(tx),
    );

    const result = await TemplateMutation.rate('u1', 'engineering-sprint', 5);

    expect(result).toEqual({ average: 4.8, count: 10 });
    expect(tx.projectTemplate.update).toHaveBeenCalledWith({
      where: { id: 'tpl1' },
      data: { ratingSum: 48, ratingCount: 10 },
    });
  });

  it('throws NotFoundError when the template is missing', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(null);
    await expect(
      TemplateMutation.rate('u1', 'missing', 5),
    ).rejects.toThrow(NotFoundError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for private or archived templates', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      id: 'tpl2',
      visibility: 'PRIVATE',
      status: 'available',
    } as never);
    await expect(
      TemplateMutation.rate('u1', 'private-one', 5),
    ).rejects.toThrow(NotFoundError);

    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      id: 'tpl3',
      visibility: 'PUBLIC',
      status: 'archived',
    } as never);
    await expect(
      TemplateMutation.rate('u1', 'archived-one', 5),
    ).rejects.toThrow(NotFoundError);
  });

  it('retries once when a concurrent first-rating hits the unique constraint (P2002)', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue(
      publicTemplate as never,
    );
    const tx = makeTx();
    const p2002 = Object.assign(new Error('unique violation'), { code: 'P2002' });
    vi.mocked(prisma.$transaction)
      .mockRejectedValueOnce(p2002)
      .mockImplementationOnce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (fn: any) => fn(tx),
      );

    const result = await TemplateMutation.rate('u1', 'engineering-sprint', 5);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ average: 5, count: 1 });
  });

  it('blocks ratings on templates above the caller tier (matches the UI lock)', async () => {
    vi.mocked(prisma.projectTemplate.findUnique).mockResolvedValue({
      id: 'tpl-pro',
      tier: 'PRO',
      visibility: 'PUBLIC',
      status: 'available',
    } as never);

    // FREE caller (no workspaces) tries to rate a PRO template.
    await expect(
      TemplateMutation.rate('u1', 'engineering-sprint', 5),
    ).rejects.toThrow('requires the Pro plan');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
