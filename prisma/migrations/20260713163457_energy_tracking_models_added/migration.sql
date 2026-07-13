-- CreateEnum
CREATE TYPE "TimeEntryCategory" AS ENUM ('DEEP_WORK', 'MEETINGS', 'ADMIN', 'LEARNING', 'BREAK', 'OTHER');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('WORKLOAD_ALERT', 'BURNOUT_PREVENTION', 'ENERGY_INSIGHT', 'FOCUS_SUGGESTION', 'CAPACITY_TIP', 'SCHEDULE_ADVICE', 'BREAK_REMINDER');

-- AlterTable
ALTER TABLE "TimeEntry" ADD COLUMN     "category" "TimeEntryCategory" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "EnergyLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "energyLevel" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnergyLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WellnessRecommendation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "message" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WellnessRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnergyLevel_userId_date_idx" ON "EnergyLevel"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "EnergyLevel_userId_date_key" ON "EnergyLevel"("userId", "date");

-- CreateIndex
CREATE INDEX "WellnessRecommendation_userId_dismissed_idx" ON "WellnessRecommendation"("userId", "dismissed");

-- CreateIndex
CREATE INDEX "WellnessRecommendation_userId_createdAt_idx" ON "WellnessRecommendation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TimeEntry_category_idx" ON "TimeEntry"("category");

-- AddForeignKey
ALTER TABLE "EnergyLevel" ADD CONSTRAINT "EnergyLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WellnessRecommendation" ADD CONSTRAINT "WellnessRecommendation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
