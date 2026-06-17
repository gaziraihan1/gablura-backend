-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('DRAFT', 'PUBLIC', 'ARCHIVE');

-- CreateTable
CREATE TABLE "popular_resources" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "popular_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_updates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "ResourceStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "popular_resources_slug_key" ON "popular_resources"("slug");

-- CreateIndex
CREATE INDEX "popular_resources_status_idx" ON "popular_resources"("status");

-- CreateIndex
CREATE INDEX "popular_resources_category_idx" ON "popular_resources"("category");

-- CreateIndex
CREATE UNIQUE INDEX "product_updates_slug_key" ON "product_updates"("slug");

-- CreateIndex
CREATE INDEX "product_updates_status_idx" ON "product_updates"("status");

-- CreateIndex
CREATE INDEX "product_updates_date_idx" ON "product_updates"("date");

-- AddForeignKey
ALTER TABLE "popular_resources" ADD CONSTRAINT "popular_resources_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_updates" ADD CONSTRAINT "product_updates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
