import { existsSync, readFileSync } from "node:fs";
import {
  PaymentStatus,
  PrismaClient,
  RoleScope,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
  VendorStatus,
} from "@prisma/client";

import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { listLedgerEntries } from "../features/ledger/services/ledger.service";
import { createVendorPaymentSchema, updateVendorPaymentStatusSchema } from "../features/vendor-payments/validations";
import {
  createVendorPayment,
  listVendorPayments,
  updateVendorPayment,
  updateVendorPaymentStatus,
  voidVendorPayment,
} from "../features/vendor-payments/services/vendor-payment.service";
import { hasPermission } from "../lib/auth/permissions";
import { ensureBaselinePermissions } from "../lib/rbac/bootstrap";
import { configureQaUserRoleAccess } from "./qa-rbac";

const prisma = new PrismaClient();

type QAStatus = "PASS" | "FAIL";
type QAResult = {
  key: string;
  status: QAStatus;
  details?: string;
};

type SessionLike = {
  user: {
    id: string;
    servicePartnerId: string;
    roleKeys: string[];
    isSuperAdmin: boolean;
  };
};

type TenantData = {
  servicePartnerId: string;
  serviceRequestId: string;
  itemId: string;
  primaryVendorId: string;
  alternateVendorId: string;
  purchaseOrderId: string;
};

const QA_PREFIX = "qa.vpay";
const COMPANY_CODE = "QAVPAYCOMP";
const FOREIGN_CODE = "QAVPAYFORE";
const REQUIRED_PERMISSION_KEYS = [
  "vendor_payments.read",
  "vendor_payments.create",
  "vendor_payments.update",
  "vendor_payments.delete",
  "vendor_payments.status.update",
] as const;

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

function toSession(input: {
  id: string;
  servicePartnerId: string;
  roleKeys: string[];
  isSuperAdmin: boolean;
}): SessionLike {
  return {
    user: {
      id: input.id,
      servicePartnerId: input.servicePartnerId,
      roleKeys: input.roleKeys,
      isSuperAdmin: input.isSuperAdmin,
    },
  };
}

async function expectThrowMessage(fn: () => Promise<unknown>) {
  try {
    await fn();
    return { threw: false as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { threw: true as const, message };
  }
}

function flattenNavKeys(items: Awaited<ReturnType<typeof getNavigationForSession>>) {
  const keys: string[] = [];
  const visit = (nodes: typeof items) => {
    for (const node of nodes) {
      keys.push(node.key);
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(items);
  return keys;
}

async function getRoleKeys(userId: string) {
  const rows = await prisma.userRole.findMany({
    where: {
      userId,
      role: { deletedAt: null },
    },
    select: {
      role: {
        select: { key: true },
      },
    },
  });
  return rows.map((row) => row.role.key);
}

async function ensureServicePartner(code: string, name: string) {
  return prisma.servicePartner.upsert({
    where: { code },
    update: {
      name,
      status: ServicePartnerStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      code,
      name,
      status: ServicePartnerStatus.ACTIVE,
    },
  });
}

async function ensureVendorPaymentNavigation(servicePartnerId: string) {
  const permission = await prisma.permission.findUnique({
    where: { key: "vendor_payments.read" },
    select: { id: true },
  });

  if (!permission) {
    throw new Error('Missing "vendor_payments.read" permission.');
  }

  const navigationItem = await prisma.navigationItem.upsert({
    where: {
      servicePartnerId_key: {
        servicePartnerId,
        key: "vendor-payments-list",
      },
    },
    update: {
      label: "Vendors Payment List",
      href: "/vendor-payments",
      isActive: true,
      sortOrder: 31,
    },
    create: {
      servicePartnerId,
      key: "vendor-payments-list",
      label: "Vendors Payment List",
      href: "/vendor-payments",
      isActive: true,
      sortOrder: 31,
    },
  });

  await prisma.navigationItemPermission.upsert({
    where: {
      navigationItemId_permissionId: {
        navigationItemId: navigationItem.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: {
      navigationItemId: navigationItem.id,
      permissionId: permission.id,
    },
  });
}

async function ensureTenantRole(input: {
  servicePartnerId: string;
  key: "company_admin" | "manager";
  name: string;
  description: string;
}) {
  return prisma.role.upsert({
    where: {
      servicePartnerId_key: {
        servicePartnerId: input.servicePartnerId,
        key: input.key,
      },
    },
    update: {
      name: input.name,
      description: input.description,
      scope: RoleScope.TENANT,
      isSystem: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      key: input.key,
      name: input.name,
      description: input.description,
      scope: RoleScope.TENANT,
      isSystem: true,
    },
  });
}

async function ensureQaUser(input: {
  servicePartnerId: string;
  roleId: string;
  email: string;
  name: string;
  phone: string;
  status: UserStatus;
}) {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      servicePartnerId: input.servicePartnerId,
      name: input.name,
      phone: input.phone,
      status: input.status,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      email: input.email,
      name: input.name,
      phone: input.phone,
      status: input.status,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: input.roleId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: input.roleId,
    },
  });

  return user;
}

async function replaceDirectPermissions(input: {
  userId: string;
  servicePartnerId: string;
  assignedByUserId: string;
  permissionKeys: string[];
}) {
  const qaKeyPrefix = QA_PREFIX.replace(/[^a-z0-9]+/gi, "_");
  await configureQaUserRoleAccess(prisma, {
    userId: input.userId,
    servicePartnerId: input.servicePartnerId,
    key: `${qaKeyPrefix}_${input.userId.slice(-8)}_access`,
    name: `QA access ${input.userId.slice(-4)}`,
    description: `QA access role for ${QA_PREFIX}`,
    permissionKeys: input.permissionKeys,
  });
}

async function ensureTenantData(input: {
  servicePartnerId: string;
  prefix: string;
  createdByUserId: string;
}): Promise<TenantData> {
  const client = await prisma.client.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-CL`,
      },
    },
    update: {
      name: `${input.prefix} Client`,
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: `${input.prefix}-CL`,
      name: `${input.prefix} Client`,
      status: "ACTIVE",
    },
  });

  const category = await prisma.category.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-CAT`,
      },
    },
    update: {
      name: `${input.prefix} Category`,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: `${input.prefix}-CAT`,
      name: `${input.prefix} Category`,
    },
  });

  const item = await prisma.item.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-ITM`,
      },
    },
    update: {
      categoryId: category.id,
      name: `${input.prefix} Item`,
      unit: "NOS",
      active: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      categoryId: category.id,
      code: `${input.prefix}-ITM`,
      name: `${input.prefix} Item`,
      unit: "NOS",
      active: true,
    },
  });

  const serviceRequest = await prisma.serviceRequest.upsert({
    where: {
      servicePartnerId_serviceNumber: {
        servicePartnerId: input.servicePartnerId,
        serviceNumber: `${input.prefix}-SR`,
      },
    },
    update: {
      clientId: client.id,
      createdByUserId: input.createdByUserId,
      title: `${input.prefix} Service`,
      description: "vendor payment qa request",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      createdByUserId: input.createdByUserId,
      serviceNumber: `${input.prefix}-SR`,
      title: `${input.prefix} Service`,
      description: "vendor payment qa request",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });

  const primaryVendor = await prisma.vendor.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-V1`,
      },
    },
    update: {
      name: `${input.prefix} Vendor 1`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: `${input.prefix}-V1`,
      name: `${input.prefix} Vendor 1`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
    },
  });

  const alternateVendor = await prisma.vendor.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-V2`,
      },
    },
    update: {
      name: `${input.prefix} Vendor 2`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: `${input.prefix}-V2`,
      name: `${input.prefix} Vendor 2`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
    },
  });

  const poNumber = `${input.prefix}-PO`;
  let purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: {
      servicePartnerId: input.servicePartnerId,
      poNumber,
    },
    select: {
      id: true,
    },
  });

  if (!purchaseOrder) {
    purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        servicePartnerId: input.servicePartnerId,
        serviceRequestId: serviceRequest.id,
        vendorId: primaryVendor.id,
        poNumber,
        status: "APPROVED",
        orderDate: new Date("2026-06-20"),
        subtotal: 500,
        taxTotal: 0,
        grandTotal: 500,
        notes: "vendor payment qa po",
        createdByUserId: input.createdByUserId,
        approvedByUserId: input.createdByUserId,
        approvedAt: new Date("2026-06-20"),
        items: {
          create: {
            itemId: item.id,
            quantity: 1,
            unitRate: 500,
            taxPercent: 0,
            amount: 500,
          },
        },
      },
      select: { id: true },
    });
  }

  return {
    servicePartnerId: input.servicePartnerId,
    serviceRequestId: serviceRequest.id,
    itemId: item.id,
    primaryVendorId: primaryVendor.id,
    alternateVendorId: alternateVendor.id,
    purchaseOrderId: purchaseOrder.id,
  };
}

async function cleanupQaRecords(input: { vendorPaymentIds: string[]; purchaseOrderIds: string[] }) {
  if (input.vendorPaymentIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        vendorPaymentId: { in: input.vendorPaymentIds },
      },
    });
    await prisma.vendorPayment.deleteMany({
      where: {
        id: { in: input.vendorPaymentIds },
      },
    });
  }

  if (input.purchaseOrderIds.length > 0) {
    await prisma.purchaseOrderItem.deleteMany({
      where: {
        purchaseOrderId: { in: input.purchaseOrderIds },
      },
    });
    await prisma.purchaseOrder.deleteMany({
      where: {
        id: { in: input.purchaseOrderIds },
      },
    });
  }
}

async function main() {
  const results: QAResult[] = [];
  const createdVendorPaymentIds: string[] = [];
  const createdPurchaseOrderIds: string[] = [];

  try {
    await ensureBaselinePermissions(prisma);

    const requiredPermissions = await prisma.permission.findMany({
      where: {
        key: { in: [...REQUIRED_PERMISSION_KEYS] },
      },
      select: { key: true },
    });
    const requiredPermissionSet = new Set(requiredPermissions.map((permission) => permission.key));
    for (const permissionKey of REQUIRED_PERMISSION_KEYS) {
      pushResult(results, `permissions.${permissionKey}.exists`, requiredPermissionSet.has(permissionKey));
    }

    const superAdmin = await prisma.user.findFirst({
      where: {
        status: UserStatus.ACTIVE,
        deletedAt: null,
        roles: {
          some: {
            role: {
              key: "super_admin",
              deletedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        servicePartnerId: true,
      },
    });
    if (!superAdmin) {
      throw new Error("Super admin user not found.");
    }
    const superRoleKeys = await getRoleKeys(superAdmin.id);
    const superSession = toSession({
      id: superAdmin.id,
      servicePartnerId: superAdmin.servicePartnerId,
      roleKeys: superRoleKeys,
      isSuperAdmin: true,
    });

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Vendor Payment Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Vendor Payment Foreign");
    await Promise.all([
      ensureVendorPaymentNavigation(companyPartner.id),
      ensureVendorPaymentNavigation(foreignPartner.id),
    ]);

    const [companyAdminRole, managerRole, foreignManagerRole] = await Promise.all([
      ensureTenantRole({
        servicePartnerId: companyPartner.id,
        key: "company_admin",
        name: "Company Admin",
        description: "Company-wide administrator",
      }),
      ensureTenantRole({
        servicePartnerId: companyPartner.id,
        key: "manager",
        name: "Manager",
        description: "Operational manager",
      }),
      ensureTenantRole({
        servicePartnerId: foreignPartner.id,
        key: "manager",
        name: "Manager",
        description: "Operational manager",
      }),
    ]);

    const companyAdminUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyAdminRole.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      name: "QA Vendor Payment Admin",
      phone: "+919981000001",
      status: UserStatus.ACTIVE,
    });
    const readOnlyUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.readonly@matrixcrm.local`,
      name: "QA Vendor Payment Read Only",
      phone: "+919981000002",
      status: UserStatus.ACTIVE,
    });
    const noReadUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noread@matrixcrm.local`,
      name: "QA Vendor Payment No Read",
      phone: "+919981000003",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Vendor Payment Foreign",
      phone: "+919981000004",
      status: UserStatus.ACTIVE,
    });

    await Promise.all([
      replaceDirectPermissions({
        userId: companyAdminUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [
          "purchase_orders.read",
          "vendor_payments.read",
          "vendor_payments.create",
          "vendor_payments.update",
          "vendor_payments.delete",
          "vendor_payments.status.update",
        ],
      }),
      replaceDirectPermissions({
        userId: readOnlyUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["purchase_orders.read", "vendor_payments.read"],
      }),
      replaceDirectPermissions({
        userId: noReadUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["purchase_orders.read"],
      }),
      replaceDirectPermissions({
        userId: foreignUser.id,
        servicePartnerId: foreignPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [
          "purchase_orders.read",
          "vendor_payments.read",
          "vendor_payments.create",
          "vendor_payments.update",
          "vendor_payments.delete",
          "vendor_payments.status.update",
        ],
      }),
    ]);

    const companyAdminSession = toSession({
      id: companyAdminUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyAdminRole.key],
      isSuperAdmin: false,
    });
    const readOnlySession = toSession({
      id: readOnlyUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [managerRole.key],
      isSuperAdmin: false,
    });
    const noReadSession = toSession({
      id: noReadUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [managerRole.key],
      isSuperAdmin: false,
    });
    const foreignSession = toSession({
      id: foreignUser.id,
      servicePartnerId: foreignPartner.id,
      roleKeys: [foreignManagerRole.key],
      isSuperAdmin: false,
    });

    const [companyData, foreignData] = await Promise.all([
      ensureTenantData({
        servicePartnerId: companyPartner.id,
        prefix: "QAVPAYCO",
        createdByUserId: companyAdminUser.id,
      }),
      ensureTenantData({
        servicePartnerId: foreignPartner.id,
        prefix: "QAVPAYFO",
        createdByUserId: foreignUser.id,
      }),
    ]);
    createdPurchaseOrderIds.push(companyData.purchaseOrderId, foreignData.purchaseOrderId);

    const requestedPayment = await createVendorPayment(companyAdminSession as never, {
      servicePartnerId: companyPartner.id,
      vendorId: companyData.primaryVendorId,
      purchaseOrderId: companyData.purchaseOrderId,
      amount: 100,
      paymentDate: new Date("2026-06-21"),
      notes: "requested only",
      status: PaymentStatus.REQUESTED,
    });
    createdVendorPaymentIds.push(requestedPayment.vendorPayment.id);
    pushResult(results, "vendor_payment.create", requestedPayment.vendorPayment.purchaseOrderId === companyData.purchaseOrderId);
    pushResult(results, "vendor_payment.number_generated", /^VPAY-[A-Z0-9]{1,6}-\d{8}-\d{4}$/.test(requestedPayment.vendorPayment.paymentNumber));
    pushResult(results, "vendor_payment.non_counted_status_does_not_post_ledger", requestedPayment.ledger.createdEntries.length === 0);

    const validationMissingDate = createVendorPaymentSchema.safeParse({
      servicePartnerId: companyPartner.id,
      vendorId: companyData.primaryVendorId,
      purchaseOrderId: companyData.purchaseOrderId,
      amount: 100,
      notes: "missing date",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "validation.payment_date_required", !validationMissingDate.success);

    const validationMissingVendor = createVendorPaymentSchema.safeParse({
      servicePartnerId: companyPartner.id,
      purchaseOrderId: companyData.purchaseOrderId,
      amount: 100,
      paymentDate: new Date("2026-06-21"),
      notes: "missing vendor",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "validation.vendor_required", !validationMissingVendor.success);

    const validationInvalidStatus = updateVendorPaymentStatusSchema.safeParse({
      status: "NOT_A_REAL_STATUS",
    });
    pushResult(results, "validation.invalid_status_rejected", !validationInvalidStatus.success);

    const updatedRequested = await updateVendorPayment(companyAdminSession as never, requestedPayment.vendorPayment.id, {
      servicePartnerId: companyPartner.id,
      vendorId: companyData.primaryVendorId,
      purchaseOrderId: companyData.purchaseOrderId,
      amount: 120,
      paymentDate: new Date("2026-06-21"),
      notes: "requested updated",
      status: PaymentStatus.REQUESTED,
    });
    pushResult(results, "vendor_payment.update", Number(updatedRequested.vendorPayment.amount) === 120);

    const paidPayment = await updateVendorPaymentStatus(companyAdminSession as never, requestedPayment.vendorPayment.id, {
      status: PaymentStatus.PAID,
    });
    pushResult(results, "vendor_payment.status_update", paidPayment.vendorPayment.status === PaymentStatus.PAID);
    pushResult(results, "vendor_payment.settled_posts_ledger", paidPayment.ledger.createdEntries.length === 1);

    const ledgerAfterPaid = await prisma.ledgerEntry.findMany({
      where: {
        vendorPaymentId: requestedPayment.vendorPayment.id,
        sourceType: "VENDOR_PAYMENT",
      },
      select: {
        debitAmount: true,
        creditAmount: true,
      },
    });
    const netAfterPaid = ledgerAfterPaid.reduce((sum, entry) => sum + Number(entry.debitAmount) - Number(entry.creditAmount), 0);
    pushResult(results, "vendor_payment.ledger_amount_matches_payment", netAfterPaid === 120);

    const repeatPaid = await updateVendorPaymentStatus(companyAdminSession as never, requestedPayment.vendorPayment.id, {
      status: PaymentStatus.PAID,
    });
    const ledgerCountAfterRepeat = await prisma.ledgerEntry.count({
      where: {
        vendorPaymentId: requestedPayment.vendorPayment.id,
        sourceType: "VENDOR_PAYMENT",
      },
    });
    pushResult(results, "vendor_payment.repeated_status_no_duplicate_net", repeatPaid.ledger.createdEntries.length === 0 && ledgerCountAfterRepeat === 1);

    const companyLedgerAfterPaid = await listLedgerEntries(companyAdminSession as never, {
      sourceType: "VENDOR_PAYMENT" as never,
      page: 1,
      pageSize: 20,
    });
    const companyLedgerEntry = companyLedgerAfterPaid.entries.find((entry) => entry.vendorPayment?.id === requestedPayment.vendorPayment.id);
    pushResult(results, "ledger.list_includes_vendor_payment_source", Boolean(companyLedgerEntry && companyLedgerEntry.sourceType === "VENDOR_PAYMENT"));

    const voidedPayment = await voidVendorPayment(companyAdminSession as never, requestedPayment.vendorPayment.id);
    pushResult(results, "vendor_payment.void", voidedPayment.vendorPayment.status === PaymentStatus.CANCELLED);
    pushResult(results, "vendor_payment.void_creates_reversal", voidedPayment.ledger.createdEntries.length === 1);
    pushResult(results, "vendor_payment.void_clears_paid_fields", !voidedPayment.vendorPayment.paidAt && !voidedPayment.vendorPayment.approvedAmount);

    const ledgerAfterVoid = await prisma.ledgerEntry.findMany({
      where: {
        vendorPaymentId: requestedPayment.vendorPayment.id,
        sourceType: "VENDOR_PAYMENT",
      },
      select: {
        debitAmount: true,
        creditAmount: true,
      },
    });
    const netAfterVoid = ledgerAfterVoid.reduce((sum, entry) => sum + Number(entry.debitAmount) - Number(entry.creditAmount), 0);
    pushResult(results, "vendor_payment.void_reversal_nets_zero", netAfterVoid === 0);
    const reversalAmount = ledgerAfterVoid.reduce((sum, entry) => sum + Number(entry.creditAmount), 0);
    pushResult(results, "vendor_payment.void_reversal_amount_matches_original", reversalAmount === 120);

    const foreignVendorMismatchBlocked = await expectThrowMessage(() =>
      createVendorPayment(companyAdminSession as never, {
        servicePartnerId: companyPartner.id,
        vendorId: foreignData.primaryVendorId,
        purchaseOrderId: companyData.purchaseOrderId,
        amount: 50,
        paymentDate: new Date("2026-06-21"),
        notes: "vendor mismatch",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.vendor_mismatch_blocked", foreignVendorMismatchBlocked.threw);

    const foreignPoBlocked = await expectThrowMessage(() =>
      createVendorPayment(companyAdminSession as never, {
        servicePartnerId: companyPartner.id,
        vendorId: companyData.primaryVendorId,
        purchaseOrderId: foreignData.purchaseOrderId,
        amount: 50,
        paymentDate: new Date("2026-06-21"),
        notes: "po mismatch",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.purchase_order_mismatch_blocked", foreignPoBlocked.threw);

    const sameTenantVendorMismatchBlocked = await expectThrowMessage(() =>
      createVendorPayment(companyAdminSession as never, {
        servicePartnerId: companyPartner.id,
        vendorId: companyData.alternateVendorId,
        purchaseOrderId: companyData.purchaseOrderId,
        amount: 50,
        paymentDate: new Date("2026-06-21"),
        notes: "same tenant vendor mismatch",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.purchase_order_vendor_mismatch_blocked", sameTenantVendorMismatchBlocked.threw);

    await prisma.vendor.update({
      where: { id: companyData.alternateVendorId },
      data: { status: VendorStatus.INACTIVE },
    });
    const inactiveVendorBlocked = await expectThrowMessage(() =>
      createVendorPayment(companyAdminSession as never, {
        servicePartnerId: companyPartner.id,
        vendorId: companyData.alternateVendorId,
        amount: 30,
        paymentDate: new Date("2026-06-21"),
        notes: "inactive vendor",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "validation.inactive_vendor_blocked", inactiveVendorBlocked.threw);
    await prisma.vendor.update({
      where: { id: companyData.alternateVendorId },
      data: { status: VendorStatus.ACTIVE },
    });

    const superAdminMismatchBlocked = await expectThrowMessage(() =>
      createVendorPayment(superSession as never, {
        servicePartnerId: companyPartner.id,
        vendorId: foreignData.primaryVendorId,
        amount: 55,
        paymentDate: new Date("2026-06-21"),
        notes: "super mismatch",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.super_admin_mismatched_records_blocked", superAdminMismatchBlocked.threw);

    const foreignPayment = await createVendorPayment(foreignSession as never, {
      servicePartnerId: foreignPartner.id,
      vendorId: foreignData.primaryVendorId,
      purchaseOrderId: foreignData.purchaseOrderId,
      amount: 80,
      paymentDate: new Date("2026-06-21"),
      notes: "foreign payment",
      status: PaymentStatus.PAID,
    });
    createdVendorPaymentIds.push(foreignPayment.vendorPayment.id);

    const companyList = await listVendorPayments(companyAdminSession as never, {});
    const foreignList = await listVendorPayments(foreignSession as never, {});
    pushResult(
      results,
      "tenant.vendor_payment_list_scoped_to_company",
      companyList.vendorPayments.some((payment) => payment.id === requestedPayment.vendorPayment.id) &&
        !companyList.vendorPayments.some((payment) => payment.id === foreignPayment.vendorPayment.id)
    );
    pushResult(
      results,
      "tenant.vendor_payment_list_scoped_to_foreign_company",
      foreignList.vendorPayments.some((payment) => payment.id === foreignPayment.vendorPayment.id) &&
        !foreignList.vendorPayments.some((payment) => payment.id === requestedPayment.vendorPayment.id)
    );

    const companyLedgerScoped = await listLedgerEntries(companyAdminSession as never, {
      sourceType: "VENDOR_PAYMENT" as never,
      page: 1,
      pageSize: 50,
    });
    pushResult(
      results,
      "tenant.tenant_user_cannot_see_foreign_vendor_payment_ledger_entries",
      !companyLedgerScoped.entries.some((entry) => entry.vendorPayment?.id === foreignPayment.vendorPayment.id)
    );

    const foreignAccessBlocked = await expectThrowMessage(() =>
      updateVendorPayment(companyAdminSession as never, foreignPayment.vendorPayment.id, {
        servicePartnerId: companyPartner.id,
        vendorId: companyData.primaryVendorId,
        purchaseOrderId: companyData.purchaseOrderId,
        amount: 40,
        paymentDate: new Date("2026-06-22"),
        notes: "should fail",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.company_admin_cannot_access_foreign_vendor_payment", foreignAccessBlocked.threw);

    const validationZeroAmount = createVendorPaymentSchema.safeParse({
      servicePartnerId: companyPartner.id,
      vendorId: companyData.primaryVendorId,
      purchaseOrderId: companyData.purchaseOrderId,
      amount: 0,
      paymentDate: new Date("2026-06-21"),
      notes: "zero",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "validation.zero_amount_rejected", !validationZeroAmount.success);

    const validationNegativeAmount = createVendorPaymentSchema.safeParse({
      servicePartnerId: companyPartner.id,
      vendorId: companyData.primaryVendorId,
      purchaseOrderId: companyData.purchaseOrderId,
      amount: -1,
      paymentDate: new Date("2026-06-21"),
      notes: "negative",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "validation.negative_amount_rejected", !validationNegativeAmount.success);

    const noReadCanRead = await hasPermission(noReadSession as never, "vendor_payments.read");
    const readOnlyCanCreate = await hasPermission(readOnlySession as never, "vendor_payments.create");
    const readOnlyCanUpdate = await hasPermission(readOnlySession as never, "vendor_payments.update");
    const readOnlyCanDelete = await hasPermission(readOnlySession as never, "vendor_payments.delete");
    const readOnlyCanStatusUpdate = await hasPermission(readOnlySession as never, "vendor_payments.status.update");
    pushResult(results, "permissions.user_without_vendor_payments_read_cannot_read", !noReadCanRead);
    pushResult(results, "permissions.user_without_vendor_payments_create_cannot_create", !readOnlyCanCreate);
    pushResult(results, "permissions.user_without_vendor_payments_update_cannot_update", !readOnlyCanUpdate);
    pushResult(results, "permissions.user_without_vendor_payments_delete_cannot_delete", !readOnlyCanDelete);
    pushResult(results, "permissions.user_without_vendor_payments_status_update_cannot_status_update", !readOnlyCanStatusUpdate);

    const readOnlyList = await listVendorPayments(readOnlySession as never, {});
    pushResult(results, "permissions.read_only_user_can_list_vendor_payments", readOnlyList.total >= 0);

    const adminNav = await getNavigationForSession(companyAdminSession as never);
    const noReadNav = await getNavigationForSession(noReadSession as never);
    const adminNavKeys = new Set(flattenNavKeys(adminNav));
    const noReadNavKeys = new Set(flattenNavKeys(noReadNav));
    pushResult(results, "navigation.vendor_payments_visible_with_permission", adminNavKeys.has("vendor-payments-list"));
    pushResult(results, "navigation.vendor_payments_hidden_without_permission", !noReadNavKeys.has("vendor-payments-list"));

    const vendorPaymentActionsSource = readFileSync("features/vendor-payments/actions/vendor-payment.actions.ts", "utf8");
    const poDetailSource = readFileSync("app/(dashboard)/purchase-orders/[id]/page.tsx", "utf8");
    const dashboardSource = readFileSync("app/(dashboard)/page.tsx", "utf8");
    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");
    const vendorPaymentsPageSource = readFileSync("app/(dashboard)/vendor-payments/page.tsx", "utf8");
    const vendorPaymentDetailSource = readFileSync("app/(dashboard)/vendor-payments/[id]/page.tsx", "utf8");
    const vendorPaymentNewPageSource = readFileSync("app/(dashboard)/vendor-payments/new/page.tsx", "utf8");
    const vendorPaymentEditPageSource = readFileSync("app/(dashboard)/vendor-payments/[id]/edit/page.tsx", "utf8");
    const vendorPaymentFormSource = readFileSync("features/vendor-payments/components/vendor-payment-form.tsx", "utf8");
    const vendorPaymentTableSource = readFileSync("features/vendor-payments/components/vendor-payments-table.tsx", "utf8");
    const ledgerSourceLinkSource = readFileSync("features/ledger/components/ledger-source-link.tsx", "utf8");
    const schemaSource = readFileSync("prisma/schema.prisma", "utf8");
    pushResult(results, "permissions.vendor_payment_action_guard_create", vendorPaymentActionsSource.includes('requirePermission("vendor_payments.create")'));
    pushResult(results, "permissions.vendor_payment_action_guard_update", vendorPaymentActionsSource.includes('requirePermission("vendor_payments.update")'));
    pushResult(results, "permissions.vendor_payment_action_guard_delete", vendorPaymentActionsSource.includes('requirePermission("vendor_payments.delete")'));
    pushResult(results, "permissions.vendor_payment_action_guard_status_update", vendorPaymentActionsSource.includes('requirePermission("vendor_payments.status.update")'));
    pushResult(results, "permissions.vendor_payment_page_guard_read", vendorPaymentsPageSource.includes('requirePermission("vendor_payments.read")'));
    pushResult(results, "permissions.vendor_payment_new_page_guard_create", vendorPaymentNewPageSource.includes('requirePermission("vendor_payments.create")'));
    pushResult(results, "permissions.vendor_payment_detail_page_guard_read", vendorPaymentDetailSource.includes('requirePermission("vendor_payments.read")'));
    pushResult(results, "permissions.vendor_payment_edit_page_guard_update", vendorPaymentEditPageSource.includes('requirePermission("vendor_payments.update")'));
    pushResult(results, "integration.purchase_order_detail_section_present", poDetailSource.includes("Vendor Payments"));
    pushResult(results, "integration.purchase_order_detail_action_present", poDetailSource.includes("Record Vendor Payment"));
    pushResult(results, "integration.purchase_order_record_payment_preselect_supported", poDetailSource.includes("/vendor-payments/new?purchaseOrderId=") && vendorPaymentNewPageSource.includes('getStringParam(params, "purchaseOrderId")'));
    pushResult(results, "integration.vendor_payment_form_validation_message_present", vendorPaymentFormSource.includes("Payment mode and reference number are not persisted") && vendorPaymentNewPageSource.includes("Please review the submitted values."));
    pushResult(results, "integration.vendor_payment_table_empty_state_present", vendorPaymentTableSource.includes("No vendor payments found."));
    pushResult(results, "integration.vendor_payment_detail_shows_ledger_status_and_timestamps", vendorPaymentDetailSource.includes("Ledger Status") && vendorPaymentDetailSource.includes("Created At") && vendorPaymentDetailSource.includes("Updated At"));
    pushResult(results, "navigation.vendor_payments_nav_active", baselineSource.includes('{ key: "vendor-payments-list", label: "Vendors Payment List", href: "/vendor-payments", sortOrder: 31, permissionKey: "vendor_payments.read", isActive: true }'));
    pushResult(results, "navigation.no_inactive_future_accounting_links", !vendorPaymentsPageSource.includes("/accounting") && !vendorPaymentsPageSource.includes("/chart-of-accounts"));
    pushResult(results, "dashboard.vendor_payment_kpi_permission_gated", dashboardSource.includes('permission: "vendor_payments.read"'));
    pushResult(results, "dashboard.vendor_payment_quick_action_permission_gated", dashboardSource.includes('permission: "vendor_payments.create"'));
    pushResult(results, "dashboard.vendor_payment_count_tenant_scoped", dashboardSource.includes('prisma.vendorPayment.count({ where: scopeByTenant(session, {}) })'));
    pushResult(results, "navigation.vendor_payment_routes_exist", existsSync("app/(dashboard)/vendor-payments/page.tsx") && existsSync("app/(dashboard)/vendor-payments/new/page.tsx") && existsSync("app/(dashboard)/vendor-payments/[id]/page.tsx"));
    pushResult(results, "ledger.source_link_points_to_vendor_payment_detail", ledgerSourceLinkSource.includes('href={`/vendor-payments/${vendorPayment.id}`}'));
    pushResult(results, "schema.vendor_payment_number_unique_constraint_exists", schemaSource.includes("@@unique([servicePartnerId, paymentNumber])"));
  } finally {
    await cleanupQaRecords({
      vendorPaymentIds: createdVendorPaymentIds,
      purchaseOrderIds: createdPurchaseOrderIds,
    });
  }

  const failed = results.filter((result) => result.status === "FAIL");
  const passed = results.filter((result) => result.status === "PASS");

  console.log(
    JSON.stringify(
      {
        summary: {
          total: results.length,
          passed: passed.length,
          failed: failed.length,
        },
        failed,
        passed: passed.map((result) => result.key),
      },
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
