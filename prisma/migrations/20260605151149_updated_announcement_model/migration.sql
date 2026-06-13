/*
  Warnings:

  - You are about to drop the column `workspaceId` on the `Announcement` table. All the data in the column will be lost.
  - Added the required column `workspaceSlug` to the `Announcement` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Announcement" DROP CONSTRAINT "Announcement_workspaceId_fkey";

-- DropIndex
DROP INDEX "Announcement_workspaceId_idx";

-- AlterTable
ALTER TABLE "Announcement" DROP COLUMN "workspaceId",
ADD COLUMN     "workspaceSlug" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Announcement_workspaceSlug_idx" ON "Announcement"("workspaceSlug");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_workspaceSlug_fkey" FOREIGN KEY ("workspaceSlug") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
