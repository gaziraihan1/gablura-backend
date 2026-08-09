-- AlterTable
ALTER TABLE "ProjectTemplate" ADD COLUMN "ratingSum" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "featured" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TemplateRating" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateRating_templateId_userId_key" ON "TemplateRating"("templateId", "userId");

-- CreateIndex
CREATE INDEX "TemplateRating_templateId_idx" ON "TemplateRating"("templateId");

-- AddForeignKey
ALTER TABLE "TemplateRating" ADD CONSTRAINT "TemplateRating_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
