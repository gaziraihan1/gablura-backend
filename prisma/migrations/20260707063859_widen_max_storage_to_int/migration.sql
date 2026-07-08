/*
  Warnings:

  - You are about to alter the column `maxStorage` on the `Workspace` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Integer`.

*/
-- AlterTable
ALTER TABLE "Workspace" ALTER COLUMN "maxStorage" SET DATA TYPE INTEGER;
