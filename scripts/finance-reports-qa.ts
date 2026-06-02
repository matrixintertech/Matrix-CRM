import { existsSync, readFileSync } from "node:fs";
import {
  InvoiceStatus,
  PaymentStatus,
  PrismaClient,
  RoleScope,
  ServicePartnerStatus,
  UserStatus,
  VendorStatus,
} from "@prisma/client";

import { getFinanceReportData } from "../features/finance-reports/services/finance-report.service";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { syncLedgerForInvoicePayment, syncLedgerForVendorPayment } from "../features/ledger/services/ledger.service";
import { ensureBaselinePermissions } from "../lib/rbac/bootstrap";

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

type TenantSeedData = {
  servicePartnerId: string;
  vendorId: string;
  invoiceIds: string[];
  paymentIds: string[];
  vendorPaymentIds: string[];
};

const QA_PREFIX = "qa.finreport";
const COMPANY_CODE = "QAFINCOMP";
const FOREIGN_CODE = "QAFINFORE";

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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isCountedPaymentStatus(status: PaymentStatus) {
  return status === PaymentStatus.APPROVED || status === PaymentStatus.PAID || status === PaymentStatus.PARTIALLY_PAID;
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

async function ensureFinanceReportsNavigation(servicePartnerId: string) {
  const permission = await prisma.permission.findUnique({
    where: { key: "reports.read" },
    select: { id: true },
  });

  if (!permission) {
    throw new Error('Missing "reports.read" permission.');
  }

  const navigationItem = await prisma.navigationItem.upsert({
    where: {
      servicePartnerId_key: {
        servicePartnerId,
        key: "finance-reports",
      },
    },
    update: {
      label: "Finance Reports",
      href: "/finance-reports",
      isActive: true,
      sortOrder: 32,
    },
    create: {
      servicePartnerId,
      key: "finance-reports",
      label: "Finance Reports",
      href: "/finance-reports",
      isActive: true,
      sortOrder: 32,
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
  key: "manager";
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
}) {
  const user = await prisma.user.upsert({
    where: { email: input.email },
    update: {
      servicePartnerId: input.servicePartnerId,
      name: input.name,
      phone: input.phone,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      email: input.email,
      name: input.name,
      phone: input.phone,
      status: UserStatus.ACTIVE,
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
  await prisma.userPermission.deleteMany({
    where: { userId: input.userId },
  });

  if (input.permissionKeys.length === 0) {
    return;
  }

  const permissions = await prisma.permission.findMany({
    where: {
      key: { in: input.permissionKeys },
    },
    select: {
      id: true,
      key: true,
    },
  });

  await prisma.userPermission.createMany({
    data: permissions.map((permission) => ({
      userId: input.userId,
      permissionId: permission.id,
      allowed: true,
      servicePartnerId: input.servicePartnerId,
      assignedByUserId: input.assignedByUserId,
    })),
    skipDuplicates: true,
  });
}

async function cleanupFinanceQaData() {
  const invoiceNumbers = [`${QA_PREFIX}-INV-1`, `${QA_PREFIX}-INV-2`, `${QA_PREFIX}-FINV-1`];
  const paymentNumbers = [`${QA_PREFIX}-PAY-1`, `${QA_PREFIX}-PAY-2`, `${QA_PREFIX}-PAY-3`, `${QA_PREFIX}-FPAY-1`];
  const vendorPaymentNumbers = [`${QA_PREFIX}-VPAY-1`, `${QA_PREFIX}-VPAY-2`, `${QA_PREFIX}-FVPAY-1`];

  const [payments, vendorPayments, invoices] = await Promise.all([
    prisma.payment.findMany({
      where: { paymentNumber: { in: paymentNumbers } },
      select: { id: true },
    }),
    prisma.vendorPayment.findMany({
      where: { paymentNumber: { in: vendorPaymentNumbers } },
      select: { id: true },
    }),
    prisma.invoice.findMany({
      where: { invoiceNumber: { in: invoiceNumbers } },
      select: { id: true },
    }),
  ]);

  const paymentIds = payments.map((entry) => entry.id);
  const vendorPaymentIds = vendorPayments.map((entry) => entry.id);
  const invoiceIds = invoices.map((entry) => entry.id);

  if (paymentIds.length > 0 || vendorPaymentIds.length > 0) {
    await prisma.ledgerEntry.deleteMany({
      where: {
        OR: [
          paymentIds.length > 0 ? { paymentId: { in: paymentIds } } : undefined,
          vendorPaymentIds.length > 0 ? { vendorPaymentId: { in: vendorPaymentIds } } : undefined,
        ].filter(Boolean) as Array<Record<string, unknown>>,
      },
    });
  }

  if (paymentIds.length > 0) {
    await prisma.payment.deleteMany({
      where: { id: { in: paymentIds } },
    });
  }

  if (vendorPaymentIds.length > 0) {
    await prisma.vendorPayment.deleteMany({
      where: { id: { in: vendorPaymentIds } },
    });
  }

  if (invoiceIds.length > 0) {
    await prisma.invoice.deleteMany({
      where: { id: { in: invoiceIds } },
    });
  }
}

async function ensureTenantData(input: {
  servicePartnerId: string;
  prefix: string;
  createdByUserId: string;
}): Promise<TenantSeedData> {
  const vendor = await prisma.vendor.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: `${input.prefix}-VEN`,
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
      code: `${input.prefix}-VEN`,
      name: `${input.prefix} Vendor`,
      status: VendorStatus.ACTIVE,
      isVerified: true,
    },
  });

  const invoiceDefinitions =
    input.prefix === "QAFINCO"
      ? [
          {
            invoiceNumber: `${QA_PREFIX}-INV-1`,
            invoiceDate: new Date("2026-06-10T00:00:00.000Z"),
            dueDate: new Date("2026-06-25T00:00:00.000Z"),
            grandTotal: 1000,
          },
          {
            invoiceNumber: `${QA_PREFIX}-INV-2`,
            invoiceDate: new Date("2026-07-05T00:00:00.000Z"),
            dueDate: new Date("2026-07-20T00:00:00.000Z"),
            grandTotal: 500,
          },
        ]
      : [
          {
            invoiceNumber: `${QA_PREFIX}-FINV-1`,
            invoiceDate: new Date("2026-06-14T00:00:00.000Z"),
            dueDate: new Date("2026-06-28T00:00:00.000Z"),
            grandTotal: 700,
          },
        ];

  const invoiceIds: string[] = [];
  for (const definition of invoiceDefinitions) {
    const invoice = await prisma.invoice.create({
      data: {
        servicePartnerId: input.servicePartnerId,
        vendorId: vendor.id,
        invoiceNumber: definition.invoiceNumber,
        status: InvoiceStatus.APPROVED,
        invoiceDate: definition.invoiceDate,
        dueDate: definition.dueDate,
        subtotal: definition.grandTotal,
        taxTotal: 0,
        grandTotal: definition.grandTotal,
        notes: "finance report qa invoice",
        createdByUserId: input.createdByUserId,
      },
      select: { id: true },
    });
    invoiceIds.push(invoice.id);
  }

  const paymentData =
    input.prefix === "QAFINCO"
      ? [
          {
            invoiceId: invoiceIds[0],
            paymentNumber: `${QA_PREFIX}-PAY-1`,
            status: PaymentStatus.PAID,
            amount: 400,
            paidAt: new Date("2026-06-11T00:00:00.000Z"),
          },
          {
            invoiceId: invoiceIds[0],
            paymentNumber: `${QA_PREFIX}-PAY-2`,
            status: PaymentStatus.REQUESTED,
            amount: 100,
            paidAt: null,
          },
          {
            invoiceId: invoiceIds[1],
            paymentNumber: `${QA_PREFIX}-PAY-3`,
            status: PaymentStatus.APPROVED,
            amount: 500,
            paidAt: new Date("2026-07-06T00:00:00.000Z"),
          },
        ]
      : [
          {
            invoiceId: invoiceIds[0],
            paymentNumber: `${QA_PREFIX}-FPAY-1`,
            status: PaymentStatus.PAID,
            amount: 300,
            paidAt: new Date("2026-06-15T00:00:00.000Z"),
          },
        ];

  const paymentIds: string[] = [];
  for (const definition of paymentData) {
    const payment = await prisma.payment.create({
      data: {
        servicePartnerId: input.servicePartnerId,
        invoiceId: definition.invoiceId,
        paymentNumber: definition.paymentNumber,
        status: definition.status,
        amount: definition.amount,
        approvedAmount: isCountedPaymentStatus(definition.status) ? definition.amount : null,
        currency: "INR",
        requestedByUserId: input.createdByUserId,
        approvedByUserId: isCountedPaymentStatus(definition.status) ? input.createdByUserId : null,
        paidByUserId: isCountedPaymentStatus(definition.status) ? input.createdByUserId : null,
        paidAt: definition.paidAt,
        remarks: "finance report qa payment",
      },
      select: { id: true },
    });
    paymentIds.push(payment.id);
  }

  const vendorPaymentData =
    input.prefix === "QAFINCO"
      ? [
          {
            paymentNumber: `${QA_PREFIX}-VPAY-1`,
            status: PaymentStatus.PAID,
            amount: 200,
            paidAt: new Date("2026-06-12T00:00:00.000Z"),
          },
          {
            paymentNumber: `${QA_PREFIX}-VPAY-2`,
            status: PaymentStatus.REQUESTED,
            amount: 50,
            paidAt: null,
          },
        ]
      : [
          {
            paymentNumber: `${QA_PREFIX}-FVPAY-1`,
            status: PaymentStatus.PAID,
            amount: 300,
            paidAt: new Date("2026-06-16T00:00:00.000Z"),
          },
        ];

  const vendorPaymentIds: string[] = [];
  for (const definition of vendorPaymentData) {
    const vendorPayment = await prisma.vendorPayment.create({
      data: {
        servicePartnerId: input.servicePartnerId,
        vendorId: vendor.id,
        paymentNumber: definition.paymentNumber,
        status: definition.status,
        amount: definition.amount,
        approvedAmount: isCountedPaymentStatus(definition.status) ? definition.amount : null,
        requestedByUserId: input.createdByUserId,
        approvedByUserId: isCountedPaymentStatus(definition.status) ? input.createdByUserId : null,
        paidByUserId: isCountedPaymentStatus(definition.status) ? input.createdByUserId : null,
        paidAt: definition.paidAt,
        remarks: "finance report qa vendor payment",
      },
      select: { id: true },
    });
    vendorPaymentIds.push(vendorPayment.id);
  }

  return {
    servicePartnerId: input.servicePartnerId,
    vendorId: vendor.id,
    invoiceIds,
    paymentIds,
    vendorPaymentIds,
  };
}

async function postLedgerEntries(input: TenantSeedData) {
  for (const paymentId of input.paymentIds) {
    await syncLedgerForInvoicePayment(prisma, { paymentId });
  }
  for (const vendorPaymentId of input.vendorPaymentIds) {
    await syncLedgerForVendorPayment(prisma, { vendorPaymentId });
  }
}

async function main() {
  const results: QAResult[] = [];

  await cleanupFinanceQaData();

  try {
    await ensureBaselinePermissions(prisma);

    const reportsPermission = await prisma.permission.findUnique({
      where: { key: "reports.read" },
      select: { id: true },
    });
    pushResult(results, "permissions.reports.read.exists", Boolean(reportsPermission));

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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Finance Reports Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Finance Reports Foreign");
    await Promise.all([
      ensureFinanceReportsNavigation(companyPartner.id),
      ensureFinanceReportsNavigation(foreignPartner.id),
    ]);

    const [companyRole, foreignRole] = await Promise.all([
      ensureTenantRole({
        servicePartnerId: companyPartner.id,
        key: "manager",
        name: "Manager",
        description: "Finance report manager",
      }),
      ensureTenantRole({
        servicePartnerId: foreignPartner.id,
        key: "manager",
        name: "Manager",
        description: "Finance report manager",
      }),
    ]);

    const companyUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyRole.id,
      email: `${QA_PREFIX}.company@matrixcrm.local`,
      name: "QA Finance Company",
      phone: "+919980100001",
    });
    const noReadUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyRole.id,
      email: `${QA_PREFIX}.noread@matrixcrm.local`,
      name: "QA Finance No Read",
      phone: "+919980100002",
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Finance Foreign",
      phone: "+919980100003",
    });

    await Promise.all([
      replaceDirectPermissions({
        userId: companyUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["reports.read"],
      }),
      replaceDirectPermissions({
        userId: noReadUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [],
      }),
      replaceDirectPermissions({
        userId: foreignUser.id,
        servicePartnerId: foreignPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["reports.read"],
      }),
    ]);

    const companySession = toSession({
      id: companyUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyRole.key],
      isSuperAdmin: false,
    });
    const noReadSession = toSession({
      id: noReadUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyRole.key],
      isSuperAdmin: false,
    });
    const foreignSession = toSession({
      id: foreignUser.id,
      servicePartnerId: foreignPartner.id,
      roleKeys: [foreignRole.key],
      isSuperAdmin: false,
    });

    const [companyData, foreignData] = await Promise.all([
      ensureTenantData({
        servicePartnerId: companyPartner.id,
        prefix: "QAFINCO",
        createdByUserId: companyUser.id,
      }),
      ensureTenantData({
        servicePartnerId: foreignPartner.id,
        prefix: "QAFINFO",
        createdByUserId: foreignUser.id,
      }),
    ]);

    await Promise.all([postLedgerEntries(companyData), postLedgerEntries(foreignData)]);

    const noReadBlocked = await expectThrowMessage(() => getFinanceReportData(noReadSession as never, { q: QA_PREFIX }));
    pushResult(results, "permissions.user_without_reports_read_cannot_access_report_service", noReadBlocked.threw);

    const companyReport = await getFinanceReportData(companySession as never, { q: QA_PREFIX });
    const foreignReport = await getFinanceReportData(foreignSession as never, { q: QA_PREFIX });
    const superReport = await getFinanceReportData(superSession as never, { q: QA_PREFIX });

    pushResult(results, "tenant.user_sees_only_own_tenant_invoice_total", companyReport.summary.totalInvoiceAmount === 1500);
    pushResult(results, "tenant.user_sees_only_own_tenant_received_total", companyReport.summary.totalReceivedAmount === 900);
    pushResult(results, "tenant.user_sees_only_own_tenant_vendor_payment_total", companyReport.summary.totalVendorPayments === 200);
    pushResult(results, "tenant.user_sees_only_own_tenant_ledger_count", companyReport.summary.ledgerEntriesCount === 3);

    pushResult(results, "tenant.foreign_user_sees_only_foreign_totals", foreignReport.summary.totalInvoiceAmount === 700 && foreignReport.summary.totalVendorPayments === 300);
    pushResult(results, "super_admin_sees_platform_totals", superReport.summary.totalInvoiceAmount === 2200 && superReport.summary.totalVendorPayments === 500);

    pushResult(results, "receivables.total_invoice_amount_matches_seeded_invoices", companyReport.summary.totalInvoiceAmount === 1500);
    pushResult(results, "receivables.total_received_amount_matches_counted_payments", companyReport.summary.totalReceivedAmount === 900);
    pushResult(results, "receivables.outstanding_matches_invoice_total_minus_counted_payments", companyReport.summary.outstandingReceivables === 600);

    const invoice1 = companyReport.receivables.find((row) => row.invoiceNumber === `${QA_PREFIX}-INV-1`);
    const invoice2 = companyReport.receivables.find((row) => row.invoiceNumber === `${QA_PREFIX}-INV-2`);
    pushResult(results, "receivables.invoice_balance_rows_correct", Boolean(invoice1 && invoice2 && invoice1.paidAmount === 400 && invoice1.balanceDue === 600 && invoice2.paidAmount === 500 && invoice2.balanceDue === 0));

    pushResult(results, "payables.total_equals_counted_vendor_payments", companyReport.summary.totalVendorPayments === 200);
    pushResult(results, "cash_movement.net_equals_incoming_minus_outgoing", companyReport.summary.netCashMovement === 700);

    pushResult(
      results,
      "ledger.summary_matches_seeded_entries",
      companyReport.ledgerSummary.entriesCount === 3 &&
        companyReport.ledgerSummary.totalDebit === 1100 &&
        companyReport.ledgerSummary.totalCredit === 0 &&
        companyReport.ledgerSummary.netAmount === 1100
    );

    const paymentSourceCount = companyReport.ledgerSummary.sourceTypeCounts.find((row) => row.sourceType === "PAYMENT");
    const vendorPaymentSourceCount = companyReport.ledgerSummary.sourceTypeCounts.find((row) => row.sourceType === "VENDOR_PAYMENT");
    pushResult(
      results,
      "ledger.source_type_counts_match_seeded_entries",
      Boolean(paymentSourceCount && vendorPaymentSourceCount && paymentSourceCount.count === 2 && vendorPaymentSourceCount.count === 1)
    );

    const juneReport = await getFinanceReportData(companySession as never, {
      q: QA_PREFIX,
      dateFrom: new Date("2026-06-01T00:00:00.000Z"),
      dateTo: new Date("2026-06-30T23:59:59.999Z"),
    });
    pushResult(
      results,
      "filters.date_range_limits_totals",
      juneReport.summary.totalInvoiceAmount === 1000 &&
        juneReport.summary.totalReceivedAmount === 400 &&
        juneReport.summary.totalVendorPayments === 200 &&
        juneReport.summary.ledgerEntriesCount === 2
    );

    pushResult(results, "filters.date_range_limits_cash_movement_rows", juneReport.cashMovement.length === 1 && juneReport.cashMovement[0]?.incoming === 400 && juneReport.cashMovement[0]?.outgoing === 200);

    const adminNavKeys = new Set(flattenNavKeys(await getNavigationForSession(companySession as never)));
    const noReadNavKeys = new Set(flattenNavKeys(await getNavigationForSession(noReadSession as never)));
    pushResult(results, "navigation.finance_reports_visible_with_permission", adminNavKeys.has("finance-reports"));
    pushResult(results, "navigation.finance_reports_hidden_without_permission", !noReadNavKeys.has("finance-reports"));

    const dashboardSource = readFileSync("app/(dashboard)/page.tsx", "utf8");
    const pageSource = readFileSync("app/(dashboard)/finance-reports/page.tsx", "utf8");
    const serviceSource = readFileSync("features/finance-reports/services/finance-report.service.ts", "utf8");
    const filtersSource = readFileSync("features/finance-reports/components/finance-report-filters.tsx", "utf8");
    const navServiceSource = readFileSync("features/navigation/services/navigation.service.ts", "utf8");
    const sidebarSource = readFileSync("components/layout/sidebar.tsx", "utf8");
    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");

    pushResult(results, "dashboard.quick_link_permission_gated", dashboardSource.includes('title: "Finance Reports"') && dashboardSource.includes('permission: "reports.read"'));
    pushResult(results, "reports.page_uses_reports_read_permission", pageSource.includes('requirePermission("reports.read")'));
    pushResult(results, "reports.service_enforces_reports_read_permission", serviceSource.includes('hasPermission(session, "reports.read")'));
    pushResult(
      results,
      "reports.page_has_no_mutation_actions",
      !pageSource.includes("/new") &&
        !pageSource.includes("/edit") &&
        !pageSource.includes("/actions/") &&
        !pageSource.includes("delete") &&
        !pageSource.includes("update")
    );
    pushResult(results, "reports.filters_are_read_only_get_based", filtersSource.includes('method="get"'));
    pushResult(results, "navigation.fallback_has_finance_reports_route", navServiceSource.includes('"finance-reports": "/finance-reports"'));
    pushResult(results, "sidebar_finance_section_includes_finance_reports", sidebarSource.includes('"finance-reports"'));
    pushResult(results, "baseline_navigation_has_finance_reports_entry", baselineSource.includes('{ key: "finance-reports", label: "Finance Reports", href: "/finance-reports", sortOrder: 32, permissionKey: "reports.read", isActive: true }'));
    pushResult(results, "finance_reports_page_exists", existsSync("app/(dashboard)/finance-reports/page.tsx"));
  } finally {
    await cleanupFinanceQaData();
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
