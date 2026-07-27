/*
  Warnings:

  - Added the required column `createdById` to the `ProjectView` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'DELAYED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ViewVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- AlterTable
ALTER TABLE "ProjectFavorite" ADD COLUMN     "group" TEXT,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProjectMilestone" ADD COLUMN     "color" TEXT,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "dependsOnId" TEXT,
ADD COLUMN     "icon" TEXT,
ADD COLUMN     "progress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "MilestoneStatus" NOT NULL DEFAULT 'ON_TRACK';

-- AlterTable
ALTER TABLE "ProjectSection" ADD COLUMN     "color" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "status" "SectionStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "ProjectView" ADD COLUMN     "config" JSONB,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "visibility" "ViewVisibility" NOT NULL DEFAULT 'PRIVATE';

-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedPoints" INTEGER,
ADD COLUMN     "retrospective" TEXT,
ADD COLUMN     "status" "SprintStatus" NOT NULL DEFAULT 'PLANNING',
ADD COLUMN     "totalPoints" INTEGER,
ADD COLUMN     "velocity" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "sprintId" TEXT;

-- CreateIndex
CREATE INDEX "ProjectFavorite_userId_sortOrder_idx" ON "ProjectFavorite"("userId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProjectView_createdById_idx" ON "ProjectView"("createdById");

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "ProjectMilestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectView" ADD CONSTRAINT "ProjectView_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
