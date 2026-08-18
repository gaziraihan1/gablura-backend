-- AlterTable
ALTER TABLE "Task" ADD COLUMN "editedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_editedById_idx" ON "Task"("editedById");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
