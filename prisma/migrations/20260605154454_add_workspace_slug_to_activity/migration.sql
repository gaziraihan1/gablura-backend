-- add with a temporary default
ALTER TABLE "Activity" ADD COLUMN "workspaceSlug" TEXT NOT NULL DEFAULT '';

-- backfill from the related Workspace row
UPDATE "Activity" a
SET "workspaceSlug" = w.slug
FROM "Workspace" w
WHERE w.id = a."workspaceId";

-- remove the default so future inserts must supply it explicitly
ALTER TABLE "Activity" ALTER COLUMN "workspaceSlug" DROP DEFAULT;