/**
 * src/scripts/seed-templates.ts
 *
 * Standalone seeding of the official template catalog.
 * Run with: npm run seed:templates
 *
 * Idempotent — safe to run any number of times (upserts by slug, keeps
 * usageCount intact).
 */
import { runTemplatesSeed } from '../modules/templates/templates.seed.js';

runTemplatesSeed()
  .then(() => {
    console.log('[Seed] Done.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Seed] Failed:', error);
    process.exit(1);
  });
