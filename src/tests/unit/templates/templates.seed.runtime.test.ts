/**
 * src/tests/unit/templates/templates.seed.runtime.test.ts
 *
 * M5 — asserts the SEED's runtime behaviour (not the data file): the upsert's
 * update branch must never touch rating fields (preserving user ratings) and
 * baseline ratings are backfilled only for templates with ratingCount = 0.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { seedOfficialTemplates } from '../../../modules/templates/templates.seed.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    projectTemplate: {
      upsert: vi.fn().mockResolvedValue({ id: 't' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('seedOfficialTemplates runtime', () => {
  it('keeps the upsert update branch free of rating fields (preserves user ratings)', async () => {
    await seedOfficialTemplates();

    for (const call of vi.mocked(prisma.projectTemplate.upsert).mock.calls) {
      const args = call[0] as { update: Record<string, unknown> };
      expect(args.update.ratingSum).toBeUndefined();
      expect(args.update.ratingCount).toBeUndefined();
    }
  });

  it('backfills baseline ratings only for templates with zero ratings', async () => {
    await seedOfficialTemplates();

    expect(prisma.projectTemplate.updateMany).toHaveBeenCalled();
    for (const call of vi.mocked(prisma.projectTemplate.updateMany).mock.calls) {
      const args = call[0] as {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      };
      expect(args.where).toMatchObject({
        slug: expect.any(String),
        ratingCount: 0,
      });
      expect((args.data.ratingCount as number)).toBeGreaterThan(0);
      expect((args.data.ratingSum as number)).toBeGreaterThan(0);
    }
  });
});
