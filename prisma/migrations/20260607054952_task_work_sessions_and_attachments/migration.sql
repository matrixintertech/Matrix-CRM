/*
  Warnings:

  - You are about to drop the column `notes` on the `TimeLog` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('IMAGE', 'PDF', 'OTHER');

-- CreateEnum
CREATE TYPE "TimeLogStatus" AS ENUM ('CHECKED_IN', 'CHECKED_OUT', 'CANCELLED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "attachmentType" "AttachmentType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "storageKey" TEXT;

-- AlterTable
ALTER TABLE "TimeLog" DROP COLUMN "notes",
ADD COLUMN     "punchInAddress" TEXT,
ADD COLUMN     "punchInNote" TEXT,
ADD COLUMN     "punchOutAddress" TEXT,
ADD COLUMN     "punchOutNote" TEXT,
ADD COLUMN     "status" "TimeLogStatus" NOT NULL DEFAULT 'CHECKED_IN';

-- CreateIndex
CREATE INDEX "Attachment_servicePartnerId_taskId_deletedAt_idx" ON "Attachment"("servicePartnerId", "taskId", "deletedAt");

-- CreateIndex
CREATE INDEX "TimeLog_servicePartnerId_taskId_userId_status_idx" ON "TimeLog"("servicePartnerId", "taskId", "userId", "status");

-- CreateIndex
CREATE INDEX "TimeLog_servicePartnerId_userId_punchOutAt_idx" ON "TimeLog"("servicePartnerId", "userId", "punchOutAt");
