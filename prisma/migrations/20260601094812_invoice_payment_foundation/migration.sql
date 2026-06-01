-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "mode" TEXT,
ADD COLUMN     "referenceNumber" TEXT;

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
