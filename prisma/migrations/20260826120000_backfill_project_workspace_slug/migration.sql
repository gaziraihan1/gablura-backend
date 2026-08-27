-- Backfill Project.workspaceSlug for legacy rows.
--
-- Background: migration 20260613051929_added_workspace_slug_to_project added
-- the nullable "workspaceSlug" column to "Project" and replaced the
-- single-column FK with a compound FK on (workspaceId, workspaceSlug) — but it
-- never populated existing rows. Because Postgres compound FKs use MATCH
-- SIMPLE semantics, any row with a NULL slug:
--   * resolves `workspace` to null in Prisma includes (even though workspaceId
--     is set), which caused 500s on GET /api/v1/projects/user/all and null
--     crashes in the frontend, and
--   * is silently excluded from ON DELETE CASCADE when its workspace is
--     deleted, leaving orphaned rows behind.
--
-- This migration is pure DML (no schema change), idempotent, and safe to run
-- any number of times.

-- 1) Fill in missing slugs from the referenced workspace. Rows whose
--    workspaceId points at a deleted workspace cannot be repaired here; they
--    are reported by `npm run check:integrity`.
UPDATE "Project" p
SET    "workspaceSlug" = w.slug
FROM   "Workspace" w
WHERE  p."workspaceId" = w.id
  AND  p."workspaceSlug" IS NULL;

-- 2) Self-heal any drift between the stored slug and the current workspace
--    slug. Under an enforced FK this finds nothing (ON UPDATE CASCADE keeps
--    them in sync); it only matters if the constraint was ever dropped.
UPDATE "Project" p
SET    "workspaceSlug" = w.slug
FROM   "Workspace" w
WHERE  p."workspaceId" = w.id
  AND  p."workspaceSlug" IS DISTINCT FROM w.slug;
