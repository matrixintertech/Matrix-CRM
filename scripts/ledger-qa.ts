import { existsSync, readFileSync } from "node:fs";
import {
  InvoiceStatus,
  LedgerSourceType,
  PaymentStatus,
  RoleScope,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
  VendorStatus,
} from "@prisma/client";

import { listLedgerEntries } from "../features/ledger/services/ledger.service";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { createInvoicePayment, updateInvoicePaymentStatus } from "../features/payments/services/payment.service";
import { hasPermission } from "../lib/auth/permissions";
import { createPrismaClient } from "../lib/db/client";
import { configureQaUserRoleAccess } from "./qa-rbac";

const prisma = createPrismaClient();

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
  vendorId: string;
};

const QA_PREFIX = "qa.ledger";
const COMPANY_CODE = "QALEDGCOMP";
const FOREIGN_CODE = "QALEDGFORE";

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

async function getRoleKeys(userId: string) {
  const rows = await prisma.userRole.findMany({
    where: {
      userId,
      role: {
        deletedAt: null,
      },
    },
    select: {
      role: {
        select: {
          key: true,
        },
      },
    },
  });
  return rows.map((row) => row.role.key);
}

function toSession(input: { id: string; servicePartnerId: string; roleKeys: string[]; isSuperAdmin: boolean }): SessionLike {
  return {
    user: {
      id: input.id,
      servicePartnerId: input.servicePartnerId,
      roleKeys: input.roleKeys,
      isSuperAdmin: input.isSuperAdmin,
    },
  };
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
      description: "ledger qa request",
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
      description: "ledger qa request",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });

  const vendor = await prisma.vendor.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-VEND`,
      },
    },
    update: {
      name: `${input.prefix} Vendor`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: `${input.prefix}-VEND`,
      name: `${input.prefix} Vendor`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
    },
  });

  return {
    servicePartnerId: input.servicePartnerId,
    serviceRequestId: serviceRequest.id,
    itemId: item.id,
    vendorId: vendor.id,
  };
}

async function createQaInvoice(input: {
  servicePartnerId: string;
  serviceRequestId: string;
  itemId: string;
  vendorId: string;
  createdByUserId: string;
  invoiceNumber: string;
  grandTotal: number;
}) {
  return prisma.invoice.create({
    data: {
      servicePartnerId: input.servicePartnerId,
      vendorId: input.vendorId,
      serviceRequestId: input.serviceRequestId,
      vendorInvoiceNumber: `${input.invoiceNumber}-VENDOR`,
      invoiceNumber: input.invoiceNumber,
      status: InvoiceStatus.APPROVED,
      invoiceDate: new Date("2026-06-10"),
      receivedDate: new Date("2026-06-10"),
      dueDate: new Date("2026-06-20"),
      subtotal: input.grandTotal,
      taxTotal: 0,
      grandTotal: input.grandTotal,
      notes: "ledger qa invoice",
      createdByUserId: input.createdByUserId,
      items: {
        create: {
          itemId: input.itemId,
          quantity: 1,
          unitRate: input.grandTotal,
          taxPercent: 0,
          amount: input.grandTotal,
        },
      },
    },
  });
}

async function cleanupQaRecords(input: { invoiceIds: string[]; paymentIds: string[] }) {
  if (input.paymentIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        paymentId: { in: input.paymentIds },
      },
    });
    await prisma.payment.deleteMany({
      where: {
        id: { in: input.paymentIds },
      },
    });
  }

  if (input.invoiceIds.length > 0) {
    await prisma.invoiceItem.deleteMany({
      where: {
        invoiceId: { in: input.invoiceIds },
      },
    });
    await prisma.invoice.deleteMany({
      where: {
        id: { in: input.invoiceIds },
      },
    });
  }
}

async function main() {
  const results: QAResult[] = [];
  const createdInvoiceIds: string[] = [];
  const createdPaymentIds: string[] = [];

  try {
    const ledgerReadPermission = await prisma.permission.findUnique({
      where: { key: "ledger.read" },
      select: { key: true },
    });
    pushResult(results, "permissions.ledger.read.exists", ledgerReadPermission?.key === "ledger.read");

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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Ledger Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Ledger Foreign");

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
    if (!companyAdminRole || !managerRole || !foreignManagerRole) {
      throw new Error("QA tenant roles could not be resolved.");
    }

    const companyAdminUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyAdminRole.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      name: "QA Ledger Admin",
      phone: "+919971000001",
      status: UserStatus.ACTIVE,
    });
    const ledgerReadOnlyUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.readonly@matrixcrm.local`,
      name: "QA Ledger Read Only",
      phone: "+919971000002",
      status: UserStatus.ACTIVE,
    });
    const noLedgerUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noledger@matrixcrm.local`,
      name: "QA Ledger No Access",
      phone: "+919971000003",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Ledger Foreign",
      phone: "+919971000004",
      status: UserStatus.ACTIVE,
    });

    await Promise.all([
      replaceDirectPermissions({
        userId: companyAdminUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read", "payments.read", "payments.create", "payments.status.update", "ledger.read"],
      }),
      replaceDirectPermissions({
        userId: ledgerReadOnlyUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read", "payments.read", "ledger.read"],
      }),
      replaceDirectPermissions({
        userId: noLedgerUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read", "payments.read"],
      }),
      replaceDirectPermissions({
        userId: foreignUser.id,
        servicePartnerId: foreignPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read", "payments.read", "payments.create", "payments.status.update", "ledger.read"],
      }),
    ]);

    const companyAdminSession = toSession({
      id: companyAdminUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyAdminRole.key],
      isSuperAdmin: false,
    });
    const readOnlySession = toSession({
      id: ledgerReadOnlyUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [managerRole.key],
      isSuperAdmin: false,
    });
    const noLedgerSession = toSession({
      id: noLedgerUser.id,
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
        prefix: "QALEDCO",
        createdByUserId: companyAdminUser.id,
      }),
      ensureTenantData({
        servicePartnerId: foreignPartner.id,
        prefix: "QALEDFO",
        createdByUserId: foreignUser.id,
      }),
    ]);

    const primaryInvoice = await createQaInvoice({
      servicePartnerId: companyData.servicePartnerId,
      serviceRequestId: companyData.serviceRequestId,
      itemId: companyData.itemId,
      vendorId: companyData.vendorId,
      createdByUserId: companyAdminUser.id,
      invoiceNumber: `QA-LED-${Date.now()}`,
      grandTotal: 250,
    });
    createdInvoiceIds.push(primaryInvoice.id);

    const foreignInvoice = await createQaInvoice({
      servicePartnerId: foreignData.servicePartnerId,
      serviceRequestId: foreignData.serviceRequestId,
      itemId: foreignData.itemId,
      vendorId: foreignData.vendorId,
      createdByUserId: foreignUser.id,
      invoiceNumber: `QA-LEDF-${Date.now()}`,
      grandTotal: 175,
    });
    createdInvoiceIds.push(foreignInvoice.id);

    const requestedPayment = await createInvoicePayment(companyAdminSession as never, {
      invoiceId: primaryInvoice.id,
      amount: 100,
      paymentDate: new Date("2026-06-11"),
      mode: "BANK_TRANSFER",
      referenceNumber: "QA-LED-REQ",
      notes: "requested only",
      status: PaymentStatus.REQUESTED,
    });
    createdPaymentIds.push(requestedPayment.payment.id);
    pushResult(results, "payment.requested_status_does_not_create_ledger_entry", requestedPayment.ledger.createdEntries.length === 0);

    const ledgerBeforePaid = await prisma.ledgerEntry.findMany({
      where: {
        paymentId: requestedPayment.payment.id,
      },
      select: { id: true },
    });
    pushResult(results, "ledger.no_entry_before_paid", ledgerBeforePaid.length === 0);

    const markedPaid = await updateInvoicePaymentStatus(companyAdminSession as never, requestedPayment.payment.id, {
      status: PaymentStatus.PAID,
    });
    pushResult(results, "payment.paid_status_creates_ledger_entry", markedPaid.ledger.createdEntries.length === 1);

    const entriesAfterPaid = await prisma.ledgerEntry.findMany({
      where: {
        paymentId: requestedPayment.payment.id,
        sourceType: LedgerSourceType.PAYMENT,
      },
      select: {
        id: true,
        debitAmount: true,
        creditAmount: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const firstPaidEntry = entriesAfterPaid[0];
    pushResult(
      results,
      "ledger.entry_amount_matches_payment",
      entriesAfterPaid.length === 1 && Number(firstPaidEntry?.debitAmount ?? 0) === 100 && Number(firstPaidEntry?.creditAmount ?? 0) === 0
    );

    const paidAgain = await updateInvoicePaymentStatus(companyAdminSession as never, requestedPayment.payment.id, {
      status: PaymentStatus.PAID,
    });
    const entriesAfterRepeat = await prisma.ledgerEntry.count({
      where: {
        paymentId: requestedPayment.payment.id,
        sourceType: LedgerSourceType.PAYMENT,
      },
    });
    pushResult(results, "ledger.repeated_paid_status_no_duplicate", paidAgain.ledger.createdEntries.length === 0 && entriesAfterRepeat === 1);

    const cancelled = await updateInvoicePaymentStatus(companyAdminSession as never, requestedPayment.payment.id, {
      status: PaymentStatus.CANCELLED,
    });
    pushResult(results, "ledger.cancelled_payment_creates_reversal", cancelled.ledger.createdEntries.length === 1);

    const entriesAfterCancel = await prisma.ledgerEntry.findMany({
      where: {
        paymentId: requestedPayment.payment.id,
        sourceType: LedgerSourceType.PAYMENT,
      },
      select: {
        debitAmount: true,
        creditAmount: true,
      },
    });
    const netAfterCancel = entriesAfterCancel.reduce((sum, entry) => sum + Number(entry.debitAmount) - Number(entry.creditAmount), 0);
    pushResult(results, "ledger.cancelled_payment_net_zero", netAfterCancel === 0);

    const repaid = await updateInvoicePaymentStatus(companyAdminSession as never, requestedPayment.payment.id, {
      status: PaymentStatus.PAID,
    });
    pushResult(results, "ledger.repaid_payment_posts_again", repaid.ledger.createdEntries.length === 1);

    const companyLedger = await listLedgerEntries(companyAdminSession as never, {
      sourceType: LedgerSourceType.PAYMENT,
      q: "QA-LED",
    });
    pushResult(results, "ledger.list_tenant_scoped_company", companyLedger.entries.every((entry) => entry.payment?.invoice?.invoiceNumber?.includes("QA-LED") ?? true));

    const foreignPayment = await createInvoicePayment(foreignSession as never, {
      invoiceId: foreignInvoice.id,
      amount: 80,
      paymentDate: new Date("2026-06-11"),
      mode: "UPI",
      referenceNumber: "QA-LED-FOREIGN",
      notes: "foreign payment",
      status: PaymentStatus.PAID,
    });
    createdPaymentIds.push(foreignPayment.payment.id);
    const foreignLedger = await listLedgerEntries(foreignSession as never, {
      sourceType: LedgerSourceType.PAYMENT,
    });
    pushResult(results, "ledger.list_tenant_scoped_foreign", foreignLedger.entries.every((entry) => entry.payment?.invoice?.invoiceNumber !== primaryInvoice.invoiceNumber));

    const noLedgerRead = await hasPermission(noLedgerSession as never, "ledger.read");
    pushResult(results, "permissions.user_without_ledger_read_cannot_list", !noLedgerRead);

    const readOnlyLedger = await listLedgerEntries(readOnlySession as never, {
      sourceType: LedgerSourceType.PAYMENT,
    });
    pushResult(results, "permissions.read_only_user_can_view_ledger", readOnlyLedger.total >= 0);

    const adminNav = await getNavigationForSession(companyAdminSession as never);
    const noLedgerNav = await getNavigationForSession(noLedgerSession as never);
    const adminNavKeys = new Set(flattenNavKeys(adminNav));
    const noLedgerNavKeys = new Set(flattenNavKeys(noLedgerNav));
    pushResult(results, "navigation.ledger_visible_with_permission", adminNavKeys.has("ledger"));
    pushResult(results, "navigation.ledger_hidden_without_permission", !noLedgerNavKeys.has("ledger"));

    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");
    const ledgerPageSource = readFileSync("app/(dashboard)/ledger/page.tsx", "utf8");
    const ledgerSourceLink = readFileSync("features/ledger/components/ledger-source-link.tsx", "utf8");
    const paymentServiceSource = readFileSync("features/payments/services/payment.service.ts", "utf8");
    pushResult(
      results,
      "navigation.ledger_nav_active",
      baselineSource.includes('{ key: "ledger", label: "Ledger", href: "/ledger", sortOrder: 23, permissionKey: "ledger.read", isActive: true }')
    );
    pushResult(results, "route.ledger_page_exists", existsSync("app/(dashboard)/ledger/page.tsx"));
    pushResult(results, "permissions.ledger_page_guard_read", ledgerPageSource.includes('requirePermission("ledger.read")'));
    pushResult(
      results,
      "integration.source_links_not_broken",
      ledgerSourceLink.includes("/invoices/") && ledgerSourceLink.includes("/service-requests/")
    );
    pushResult(
      results,
      "integration.payment_service_posts_to_ledger",
      paymentServiceSource.includes("syncLedgerForInvoicePayment")
    );

    const dashboardSource = readFileSync("app/(dashboard)/page.tsx", "utf8");
    pushResult(results, "dashboard.ledger_kpi_permission_gated", dashboardSource.includes('permission: "ledger.read"'));
    pushResult(results, "dashboard.ledger_count_tenant_scoped", dashboardSource.includes('prisma.ledgerEntry.count({ where: scopeByTenant(session, {}) })'));
  } finally {
    await cleanupQaRecords({
      invoiceIds: createdInvoiceIds,
      paymentIds: createdPaymentIds,
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
