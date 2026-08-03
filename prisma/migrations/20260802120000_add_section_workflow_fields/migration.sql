-- AlterTable
ALTER TABLE "ProjectSection" ADD COLUMN     "taskStatus" "TaskStatus",
ADD COLUMN     "wipLimit" INTEGER DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSection_projectId_taskStatus_key" ON "ProjectSection"("projectId", "taskStatus");
