-- DropForeignKey
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_workspaceSlug_fkey";

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_workspaceSlug_fkey" FOREIGN KEY ("workspaceSlug") REFERENCES "Workspace"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
