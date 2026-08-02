-- AlterTable
ALTER TABLE "BurnoutSignal" ADD COLUMN     "updatedAt" TIMESTAMP(3);

-- Backfill existing rows so the NOT NULL constraint can be applied
UPDATE "BurnoutSignal" SET "updatedAt" = NOW() WHERE "updatedAt" IS NULL;

-- Enforce NOT NULL (Prisma @updatedAt requires it)
ALTER TABLE "BurnoutSignal" ALTER COLUMN "updatedAt" SET NOT NULL;
