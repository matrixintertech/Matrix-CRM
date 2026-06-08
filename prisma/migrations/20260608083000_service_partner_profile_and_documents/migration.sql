ALTER TABLE "ServicePartner"
ADD COLUMN     "gstNumber" TEXT,
ADD COLUMN     "shortProfile" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bankBranch" TEXT,
ADD COLUMN     "bankIfscCode" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT;

ALTER TABLE "Attachment"
ADD COLUMN     "documentLabel" TEXT;

CREATE INDEX "Attachment_servicePartnerId_deletedAt_idx" ON "Attachment"("servicePartnerId", "deletedAt");
