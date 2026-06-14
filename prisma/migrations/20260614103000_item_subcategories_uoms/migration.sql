-- CreateTable
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL,
    "servicePartnerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Subcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Uom" (
    "id" TEXT NOT NULL,
    "servicePartnerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Uom_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Item"
ADD COLUMN "subcategoryId" TEXT,
ADD COLUMN "uomId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subcategory_servicePartnerId_categoryId_code_key" ON "Subcategory"("servicePartnerId", "categoryId", "code");

-- CreateIndex
CREATE INDEX "Subcategory_servicePartnerId_idx" ON "Subcategory"("servicePartnerId");

-- CreateIndex
CREATE INDEX "Subcategory_categoryId_idx" ON "Subcategory"("categoryId");

-- CreateIndex
CREATE INDEX "Subcategory_servicePartnerId_deletedAt_idx" ON "Subcategory"("servicePartnerId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Uom_servicePartnerId_code_key" ON "Uom"("servicePartnerId", "code");

-- CreateIndex
CREATE INDEX "Uom_servicePartnerId_idx" ON "Uom"("servicePartnerId");

-- CreateIndex
CREATE INDEX "Uom_active_idx" ON "Uom"("active");

-- CreateIndex
CREATE INDEX "Uom_servicePartnerId_deletedAt_idx" ON "Uom"("servicePartnerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Item_subcategoryId_idx" ON "Item"("subcategoryId");

-- CreateIndex
CREATE INDEX "Item_uomId_idx" ON "Item"("uomId");

-- AddForeignKey
ALTER TABLE "Subcategory"
ADD CONSTRAINT "Subcategory_servicePartnerId_fkey"
FOREIGN KEY ("servicePartnerId") REFERENCES "ServicePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subcategory"
ADD CONSTRAINT "Subcategory_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Uom"
ADD CONSTRAINT "Uom_servicePartnerId_fkey"
FOREIGN KEY ("servicePartnerId") REFERENCES "ServicePartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item"
ADD CONSTRAINT "Item_subcategoryId_fkey"
FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item"
ADD CONSTRAINT "Item_uomId_fkey"
FOREIGN KEY ("uomId") REFERENCES "Uom"("id") ON DELETE SET NULL ON UPDATE CASCADE;
