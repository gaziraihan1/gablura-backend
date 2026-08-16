-- AlterTable
-- Burnout signals now record the energy and focus-session strain that
-- contributed to the risk level, so trends can show why risk moved.
ALTER TABLE "BurnoutSignal" ADD COLUMN "avgEnergy" DOUBLE PRECISION,
ADD COLUMN "lowEnergyDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "focusMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "focusOverloadDays" INTEGER NOT NULL DEFAULT 0;
