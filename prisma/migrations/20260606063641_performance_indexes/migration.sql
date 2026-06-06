-- CreateIndex
CREATE INDEX "ActivityLog_servicePartnerId_createdAt_idx" ON "ActivityLog"("servicePartnerId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_servicePartnerId_entityType_entityId_idx" ON "ActivityLog"("servicePartnerId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "Assignment_servicePartnerId_userId_unassignedAt_idx" ON "Assignment"("servicePartnerId", "userId", "unassignedAt");

-- CreateIndex
CREATE INDEX "Assignment_serviceRequestId_unassignedAt_idx" ON "Assignment"("serviceRequestId", "unassignedAt");

-- CreateIndex
CREATE INDEX "Branch_servicePartnerId_deletedAt_idx" ON "Branch"("servicePartnerId", "deletedAt");

-- CreateIndex
CREATE INDEX "Branch_clientId_deletedAt_idx" ON "Branch"("clientId", "deletedAt");

-- CreateIndex
CREATE INDEX "Client_servicePartnerId_deletedAt_status_idx" ON "Client"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Client_servicePartnerId_deletedAt_name_idx" ON "Client"("servicePartnerId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "Invoice_purchaseOrderId_idx" ON "Invoice"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Invoice_servicePartnerId_deletedAt_status_idx" ON "Invoice"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Invoice_servicePartnerId_invoiceDate_idx" ON "Invoice"("servicePartnerId", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_deletedAt_idx" ON "Invoice"("vendorId", "deletedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_servicePartnerId_sourceType_entryDate_idx" ON "LedgerEntry"("servicePartnerId", "sourceType", "entryDate");

-- CreateIndex
CREATE INDEX "OtpChallenge_target_purpose_consumedAt_createdAt_idx" ON "OtpChallenge"("target", "purpose", "consumedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_servicePartnerId_userId_purpose_consumedAt_cre_idx" ON "OtpChallenge"("servicePartnerId", "userId", "purpose", "consumedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_servicePartnerId_status_createdAt_idx" ON "Payment"("servicePartnerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_status_idx" ON "Payment"("invoiceId", "status");

-- CreateIndex
CREATE INDEX "Payment_servicePartnerId_paidAt_idx" ON "Payment"("servicePartnerId", "paidAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_servicePartnerId_deletedAt_status_idx" ON "PurchaseOrder"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_servicePartnerId_orderDate_idx" ON "PurchaseOrder"("servicePartnerId", "orderDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_vendorId_deletedAt_idx" ON "PurchaseOrder"("vendorId", "deletedAt");

-- CreateIndex
CREATE INDEX "Rfq_servicePartnerId_deletedAt_status_idx" ON "Rfq"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "ServicePartner_deletedAt_status_idx" ON "ServicePartner"("deletedAt", "status");

-- CreateIndex
CREATE INDEX "ServicePartner_deletedAt_name_idx" ON "ServicePartner"("deletedAt", "name");

-- CreateIndex
CREATE INDEX "ServiceRequest_servicePartnerId_deletedAt_status_idx" ON "ServiceRequest"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "ServiceRequest_servicePartnerId_clientId_deletedAt_idx" ON "ServiceRequest"("servicePartnerId", "clientId", "deletedAt");

-- CreateIndex
CREATE INDEX "ServiceRequest_servicePartnerId_requestedAt_idx" ON "ServiceRequest"("servicePartnerId", "requestedAt");

-- CreateIndex
CREATE INDEX "Task_servicePartnerId_deletedAt_status_idx" ON "Task"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Task_assigneeUserId_deletedAt_status_idx" ON "Task"("assigneeUserId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Task_parentTaskId_deletedAt_idx" ON "Task"("parentTaskId", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_serviceRequestId_deletedAt_idx" ON "Task"("serviceRequestId", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_servicePartnerId_requestedAt_idx" ON "Task"("servicePartnerId", "requestedAt");

-- CreateIndex
CREATE INDEX "User_servicePartnerId_deletedAt_status_idx" ON "User"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "User_servicePartnerId_lastLoginAt_idx" ON "User"("servicePartnerId", "lastLoginAt");

-- CreateIndex
CREATE INDEX "Vendor_servicePartnerId_deletedAt_status_idx" ON "Vendor"("servicePartnerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "VendorPayment_purchaseOrderId_idx" ON "VendorPayment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "VendorPayment_servicePartnerId_status_createdAt_idx" ON "VendorPayment"("servicePartnerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "VendorPayment_servicePartnerId_paidAt_idx" ON "VendorPayment"("servicePartnerId", "paidAt");
