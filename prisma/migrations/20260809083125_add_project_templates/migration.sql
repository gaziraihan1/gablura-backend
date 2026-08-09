-- CreateEnum
CREATE TYPE "TemplateTier" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "longDescription" TEXT,
    "category" TEXT NOT NULL,
    "complexity" TEXT NOT NULL,
    "tier" "TemplateTier" NOT NULL DEFAULT 'PRO',
    "icon" TEXT,
    "color" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "workspaceId" TEXT,
    "sourceProjectId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT,
    "authorRole" TEXT,
    "content" JSONB NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedSetupMinutes" INTEGER NOT NULL DEFAULT 5,
    "tags" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTemplate_slug_key" ON "ProjectTemplate"("slug");

-- CreateIndex
CREATE INDEX "ProjectTemplate_visibility_category_idx" ON "ProjectTemplate"("visibility", "category");

-- CreateIndex
CREATE INDEX "ProjectTemplate_tier_idx" ON "ProjectTemplate"("tier");

-- CreateIndex
CREATE INDEX "ProjectTemplate_workspaceId_idx" ON "ProjectTemplate"("workspaceId");
