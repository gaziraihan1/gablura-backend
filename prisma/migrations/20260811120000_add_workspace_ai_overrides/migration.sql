-- AlterTable
-- Per-workspace Gablura-admin overrides for AI limits (null = plan default).
ALTER TABLE "Workspace" ADD COLUMN "aiDailyCalls" INTEGER,
ADD COLUMN "aiMonthlyTokens" INTEGER,
ADD COLUMN "aiMaxOutputTokens" INTEGER;
