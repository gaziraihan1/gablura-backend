/**
 * modules/templates/templates.seed.ts
 *
 * Idempotent seeding of the official template catalog. Upserts by slug and
 * never touches `usageCount` so re-running (deploys, migrations) keeps the
 * stats that matter to users.
 */
import { prisma } from '../../lib/prisma.js';
import { OFFICIAL_TEMPLATES } from './templates.data.js';

export async function seedOfficialTemplates(): Promise<number> {
  let upserted = 0;

  for (const t of OFFICIAL_TEMPLATES) {
    const content = t.content as object;

    await prisma.projectTemplate.upsert({
      where: { slug: t.slug },
      update: {
        title: t.title,
        description: t.description,
        longDescription: t.longDescription,
        category: t.category,
        complexity: t.complexity,
        tier: t.tier,
        icon: t.icon,
        color: t.color,
        status: 'available',
        visibility: 'PUBLIC',
        authorName: t.authorName,
        authorRole: t.authorRole,
        tags: t.tags as unknown as object,
        estimatedSetupMinutes: t.estimatedSetupMinutes,
        content,
      },
      create: {
        slug: t.slug,
        title: t.title,
        description: t.description,
        longDescription: t.longDescription,
        category: t.category,
        complexity: t.complexity,
        tier: t.tier,
        icon: t.icon,
        color: t.color,
        status: 'available',
        visibility: 'PUBLIC',
        authorName: t.authorName,
        authorRole: t.authorRole,
        tags: t.tags as unknown as object,
        estimatedSetupMinutes: t.estimatedSetupMinutes,
        content,
      },
    });

    upserted += 1;
  }

  return upserted;
}

/** Convenience entry point used by scripts / npm run seed:templates. */
export async function runTemplatesSeed(): Promise<void> {
  const count = await seedOfficialTemplates();
  console.log(`[Seed] Official templates ready: ${count}`);
}
