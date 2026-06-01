/*
  Warnings:

  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE IF EXISTS "AuditLog";

-- CreateTable
CREATE TABLE "SubscribeList" (
    "email" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscribeList_email_key" ON "SubscribeList"("email");
