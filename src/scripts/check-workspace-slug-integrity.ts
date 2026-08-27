/**
 * src/scripts/check-workspace-slug-integrity.ts
 *
 * Data-integrity gate for the Project → Workspace compound FK
 * (workspaceId, workspaceSlug). Flags rows that resolve `workspace` to null in
 * Prisma includes and silently escape ON DELETE CASCADE:
 *
 *   1. NULL slug   — Project has a workspaceId but no workspaceSlug (legacy
 *                    rows from before migration 20260826120000).
 *   2. Dangling    — Project.workspaceId points at a workspace that no longer
 *                    exists (unrepairable; rows should be re-homed or deleted).
 *   3. Slug drift  — stored workspaceSlug does not match the current workspace
 *                    slug (only possible if the FK was dropped at some point).
 *
 * Exit codes: 0 = clean, 1 = problems found.
 *
 * Run with: npm run check:integrity
 * Point DATABASE_URL at any environment (local dev, test, or production).
 */
import { prisma } from '../lib/prisma.js';

interface Problem {
  projectId: string;
  kind: 'NULL_SLUG_RESOLVABLE' | 'NULL_SLUG_DANGLING' | 'SLUG_DRIFT';
  workspaceId: string | null;
  detail: string;
}

async function main(): Promise<number> {
  const problems: Problem[] = [];

  // ── 1 & 2. Rows with a workspaceId but no slug ─────────────────────────────
  const nullSlugRows = await prisma.project.findMany({
    where: { workspaceId: { not: null }, workspaceSlug: null },
    select: { id: true, workspaceId: true },
  });

  if (nullSlugRows.length > 0) {
    const workspaceIds = [
      ...new Set(nullSlugRows.map((r) => r.workspaceId as string)),
    ];
    const existing = await prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      select: { id: true, slug: true },
    });
    const existingById = new Map(existing.map((w) => [w.id, w.slug]));

    for (const row of nullSlugRows) {
      const wsId = row.workspaceId as string;
      const currentSlug = existingById.get(wsId);
      if (currentSlug !== undefined) {
        problems.push({
          projectId: row.id,
          kind: 'NULL_SLUG_RESOLVABLE',
          workspaceId: wsId,
          detail: `run migration 20260826120000 (or set workspaceSlug="${currentSlug}")`,
        });
      } else {
        problems.push({
          projectId: row.id,
          kind: 'NULL_SLUG_DANGLING',
          workspaceId: wsId,
          detail: 'workspaceId references a deleted workspace — re-home or delete this project',
        });
      }
    }
  }

  // ── 3. Slug drift (FK dropped/re-added without cascade at some point) ──────
  const drifted = await prisma.$queryRaw<{ id: string; workspaceId: string; stored: string; actual: string }[]>`
    SELECT p."id", p."workspaceId", p."workspaceSlug" AS stored, w."slug" AS actual
    FROM "Project" p
    JOIN "Workspace" w ON w."id" = p."workspaceId"
    WHERE p."workspaceSlug" IS DISTINCT FROM w."slug"
  `;
  for (const row of drifted) {
    problems.push({
      projectId: row.id,
      kind: 'SLUG_DRIFT',
      workspaceId: row.workspaceId,
      detail: `stored "${row.stored}" != current slug "${row.actual}"`,
    });
  }

  // ── Report ──────────────────────────────────────────────────────────────────
  const totalProjects = await prisma.project.count();
  if (problems.length === 0) {
    console.log(
      `[check:integrity] OK — all ${totalProjects} projects have consistent (workspaceId, workspaceSlug) pairs.`,
    );
    return 0;
  }

  console.error(
    `[check:integrity] FAILED — ${problems.length} of ${totalProjects} projects have inconsistent workspace links:\n`,
  );
  for (const p of problems.slice(0, 50)) {
    console.error(`  project ${p.projectId} [${p.kind}] ${p.detail}`);
  }
  if (problems.length > 50) {
    console.error(`  ...and ${problems.length - 50} more`);
  }
  return 1;
}

main()
  .then((code) => {
    void prisma.$disconnect();
    process.exit(code);
  })
  .catch((error) => {
    console.error('[check:integrity] Error running integrity check:', error);
    void prisma.$disconnect();
    process.exit(1);
  });
