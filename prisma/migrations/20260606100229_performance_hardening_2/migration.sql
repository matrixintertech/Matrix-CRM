-- CreateIndex
CREATE INDEX "City_stateId_isActive_name_idx" ON "City"("stateId", "isActive", "name");

-- CreateIndex
CREATE INDEX "NavigationItem_servicePartnerId_isActive_sortOrder_idx" ON "NavigationItem"("servicePartnerId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ServiceRequest_servicePartnerId_branchId_deletedAt_idx" ON "ServiceRequest"("servicePartnerId", "branchId", "deletedAt");

-- CreateIndex
CREATE INDEX "State_isActive_name_idx" ON "State"("isActive", "name");

-- CreateIndex
CREATE INDEX "Task_servicePartnerId_parentTaskId_deletedAt_idx" ON "Task"("servicePartnerId", "parentTaskId", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_servicePartnerId_assigneeUserId_deletedAt_idx" ON "Task"("servicePartnerId", "assigneeUserId", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_servicePartnerId_createdByUserId_deletedAt_idx" ON "Task"("servicePartnerId", "createdByUserId", "deletedAt");

-- CreateIndex
CREATE INDEX "Task_servicePartnerId_assignedByUserId_deletedAt_idx" ON "Task"("servicePartnerId", "assignedByUserId", "deletedAt");
