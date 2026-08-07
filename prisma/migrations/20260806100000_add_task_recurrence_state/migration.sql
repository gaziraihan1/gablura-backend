-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "recurrenceDueDate" TIMESTAMP(3),
ADD COLUMN     "recurrenceId" TEXT;

-- AlterTable
ALTER TABLE "TaskRecurrence" ADD COLUMN     "lastOccurredAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Task_recurrenceId_recurrenceDueDate_key" ON "Task"("recurrenceId", "recurrenceDueDate");
