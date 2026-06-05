ALTER TABLE "Invoice"
ADD COLUMN "vendorInvoiceNumber" TEXT,
ADD COLUMN "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Invoice"
SET "vendorInvoiceNumber" = COALESCE(NULLIF(BTRIM("invoiceNumber"), ''), CONCAT('LEGACY-', SUBSTRING("id" FROM 1 FOR 8)))
WHERE "vendorInvoiceNumber" IS NULL;

ALTER TABLE "Invoice"
ALTER COLUMN "vendorInvoiceNumber" SET NOT NULL;

CREATE UNIQUE INDEX "Invoice_servicePartnerId_vendorId_vendorInvoiceNumber_key"
ON "Invoice"("servicePartnerId", "vendorId", "vendorInvoiceNumber");
