-- Historical migration added locally to reconcile Prisma migration history with the
-- already-applied database state. Runtime RBAC remains role-based; the current
-- schema removes this table in a later migration.
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "servicePartnerId" TEXT,
    "assignedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPermission_userId_permissionId_key" ON "UserPermission"("userId", "permissionId");
CREATE INDEX "UserPermission_userId_idx" ON "UserPermission"("userId");
CREATE INDEX "UserPermission_permissionId_idx" ON "UserPermission"("permissionId");
CREATE INDEX "UserPermission_servicePartnerId_idx" ON "UserPermission"("servicePartnerId");
CREATE INDEX "UserPermission_assignedByUserId_idx" ON "UserPermission"("assignedByUserId");
CREATE INDEX "UserPermission_userId_allowed_idx" ON "UserPermission"("userId", "allowed");

ALTER TABLE "UserPermission"
ADD CONSTRAINT "UserPermission_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPermission"
ADD CONSTRAINT "UserPermission_permissionId_fkey"
FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPermission"
ADD CONSTRAINT "UserPermission_servicePartnerId_fkey"
FOREIGN KEY ("servicePartnerId") REFERENCES "ServicePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserPermission"
ADD CONSTRAINT "UserPermission_assignedByUserId_fkey"
FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
