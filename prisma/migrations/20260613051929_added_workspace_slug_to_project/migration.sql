/*
  Warnings:

  - A unique constraint covering the columns `[id,slug]` on the table `Workspace` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_workspaceId_fkey";

-- DropIndex
DROP INDEX "Project_workspaceId_idx";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "workspaceSlug" TEXT;

-- CreateIndex
CREATE INDEX "Project_workspaceId_workspaceSlug_idx" ON "Project"("workspaceId", "workspaceSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_id_slug_key" ON "Workspace"("id", "slug");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_workspaceSlug_fkey" FOREIGN KEY ("workspaceId", "workspaceSlug") REFERENCES "Workspace"("id", "slug") ON DELETE CASCADE ON UPDATE CASCADE;
