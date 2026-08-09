-- CreateEnum
CREATE TYPE "AutomationTrigger" AS ENUM ('STATUS_CHANGED', 'TASK_CREATED');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('ASSIGN_USER', 'SET_PRIORITY', 'NOTIFY_MEMBERS');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'AUTOMATION_RUN';

-- AlterEnum
ALTER TYPE "EntityType" ADD VALUE 'AUTOMATION';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AUTOMATION_TRIGGERED';

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "triggerType" "AutomationTrigger" NOT NULL,
    "triggerConfig" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_workspaceId_enabled_idx" ON "AutomationRule"("workspaceId", "enabled");

-- CreateIndex
CREATE INDEX "AutomationRule_projectId_idx" ON "AutomationRule"("projectId");

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
