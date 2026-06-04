-- CreateEnum
CREATE TYPE "EmailChangeRequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'OTP_SENT', 'VERIFIED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'EMAIL_CHANGE';

-- AlterEnum
ALTER TYPE "ActivityEntityType" ADD VALUE 'EMAIL_CHANGE_REQUEST';

-- DropForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT "UserPermission_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT "UserPermission_permissionId_fkey";

-- DropForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT "UserPermission_servicePartnerId_fkey";

-- DropForeignKey
ALTER TABLE "UserPermission" DROP CONSTRAINT "UserPermission_assignedByUserId_fkey";

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "requestedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "UserPermission";

-- CreateTable
CREATE TABLE "EmailChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "servicePartnerId" TEXT NOT NULL,
    "oldEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "status" "EmailChangeRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailChangeRequest_userId_status_idx" ON "EmailChangeRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_servicePartnerId_status_idx" ON "EmailChangeRequest"("servicePartnerId", "status");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_newEmail_idx" ON "EmailChangeRequest"("newEmail");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_requestedAt_idx" ON "EmailChangeRequest"("requestedAt");

-- CreateIndex
CREATE INDEX "EmailChangeRequest_expiresAt_idx" ON "EmailChangeRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "EmailChangeRequest"
ADD CONSTRAINT "EmailChangeRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailChangeRequest"
ADD CONSTRAINT "EmailChangeRequest_servicePartnerId_fkey"
FOREIGN KEY ("servicePartnerId") REFERENCES "ServicePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailChangeRequest"
ADD CONSTRAINT "EmailChangeRequest_reviewedByUserId_fkey"
FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
