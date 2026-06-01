import { existsSync, readFileSync } from "node:fs";
import {
  InvoiceStatus,
  PaymentStatus,
  PrismaClient,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
  VendorStatus,
} from "@prisma/client";

import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { createPaymentSchema } from "../features/payments/validations";
import {
  createInvoicePayment,
  listPaymentsForInvoice,
  updateInvoicePayment,
  updateInvoicePaymentStatus,
  voidInvoicePayment,
} from "../features/payments/services/payment.service";
import { hasPermission } from "../lib/auth/permissions";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";

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
  vendorId: string;
};

const QA_PREFIX = "qa.pay";
const COMPANY_CODE = "QAPAYCOMP";
const FOREIGN_CODE = "QAPAYFORE";
const REQUIRED_PERMISSION_KEYS = [
  "payments.read",
  "payments.create",
  "payments.update",
  "payments.delete",
  "payments.status.update",
] as const;

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
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

async function ensureServicePartner(code: string, name: string) {
  const servicePartner = await prisma.servicePartner.upsert({
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

  await ensureTenantRbac(prisma, {
    servicePartnerId: servicePartner.id,
    includePlatformRole: false,
  });

  return servicePartner;
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
  await prisma.userPermission.deleteMany({
    where: {
      userId: input.userId,
    },
  });

  if (input.permissionKeys.length === 0) {
    return;
  }

  const permissions = await prisma.permission.findMany({
    where: {
      key: {
        in: input.permissionKeys,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });
  const idByKey = new Map(permissions.map((permission) => [permission.key, permission.id]));
  const permissionIds = input.permissionKeys
    .map((key) => idByKey.get(key))
    .filter((value): value is string => Boolean(value));

  await prisma.userPermission.createMany({
    data: permissionIds.map((permissionId) => ({
      userId: input.userId,
      permissionId,
      allowed: true,
      servicePartnerId: input.servicePartnerId,
      assignedByUserId: input.assignedByUserId,
    })),
    skipDuplicates: true,
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
      description: "payment qa request",
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
      description: "payment qa request",
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
      invoiceNumber: input.invoiceNumber,
      status: InvoiceStatus.APPROVED,
      invoiceDate: new Date("2026-06-05"),
      dueDate: new Date("2026-06-15"),
      subtotal: input.grandTotal,
      taxTotal: 0,
      grandTotal: input.grandTotal,
      notes: "payment qa invoice",
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
    const requiredPermissions = await prisma.permission.findMany({
      where: {
        key: {
          in: [...REQUIRED_PERMISSION_KEYS],
        },
      },
      select: {
        key: true,
      },
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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Payment Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Payment Foreign");

    const companyAdminRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: companyPartner.id,
        key: "company_admin",
        deletedAt: null,
      },
      select: { id: true, key: true },
    });
    const managerRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: companyPartner.id,
        key: "manager",
        deletedAt: null,
      },
      select: { id: true, key: true },
    });
    const foreignManagerRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: foreignPartner.id,
        key: "manager",
        deletedAt: null,
      },
      select: { id: true, key: true },
    });
    if (!companyAdminRole || !managerRole || !foreignManagerRole) {
      throw new Error("QA tenant roles could not be resolved.");
    }

    const companyAdminUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyAdminRole.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      name: "QA Payment Admin",
      phone: "+919961000001",
      status: UserStatus.ACTIVE,
    });
    const readOnlyUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.readonly@matrixcrm.local`,
      name: "QA Payment Read Only",
      phone: "+919961000002",
      status: UserStatus.ACTIVE,
    });
    const noReadUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noread@matrixcrm.local`,
      name: "QA Payment No Read",
      phone: "+919961000003",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Payment Foreign",
      phone: "+919961000004",
      status: UserStatus.ACTIVE,
    });

    await Promise.all([
      replaceDirectPermissions({
        userId: companyAdminUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [
          "invoices.read",
          "payments.read",
          "payments.create",
          "payments.update",
          "payments.delete",
          "payments.status.update",
        ],
      }),
      replaceDirectPermissions({
        userId: readOnlyUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read", "payments.read"],
      }),
      replaceDirectPermissions({
        userId: noReadUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read"],
      }),
      replaceDirectPermissions({
        userId: foreignUser.id,
        servicePartnerId: foreignPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read", "payments.read", "payments.create", "payments.update"],
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
        prefix: "QAPAYCO",
        createdByUserId: companyAdminUser.id,
      }),
      ensureTenantData({
        servicePartnerId: foreignPartner.id,
        prefix: "QAPAYFO",
        createdByUserId: foreignUser.id,
      }),
    ]);

    const primaryInvoice = await createQaInvoice({
      servicePartnerId: companyData.servicePartnerId,
      serviceRequestId: companyData.serviceRequestId,
      itemId: companyData.itemId,
      vendorId: companyData.vendorId,
      createdByUserId: companyAdminUser.id,
      invoiceNumber: `QA-PAY-${Date.now()}`,
      grandTotal: 300,
    });
    createdInvoiceIds.push(primaryInvoice.id);

    const foreignInvoice = await createQaInvoice({
      servicePartnerId: foreignData.servicePartnerId,
      serviceRequestId: foreignData.serviceRequestId,
      itemId: foreignData.itemId,
      vendorId: foreignData.vendorId,
      createdByUserId: foreignUser.id,
      invoiceNumber: `QA-PAY-FO-${Date.now()}`,
      grandTotal: 250,
    });
    createdInvoiceIds.push(foreignInvoice.id);

    const createdPayment = await createInvoicePayment(companyAdminSession as never, {
      invoiceId: primaryInvoice.id,
      amount: 100,
      paymentDate: new Date("2026-06-06"),
      mode: "BANK_TRANSFER",
      referenceNumber: "QA-PAY-REF-1",
      notes: "first payment",
      status: PaymentStatus.PAID,
    });
    createdPaymentIds.push(createdPayment.payment.id);
    pushResult(results, "payment.create_for_invoice", createdPayment.payment.invoiceId === primaryInvoice.id);
    pushResult(results, "payment.number_generated", /^PAY-[A-Z0-9]{1,6}-\d{8}-\d{4}$/.test(createdPayment.payment.paymentNumber));

    const afterFirstPayment = await listPaymentsForInvoice(companyAdminSession as never, primaryInvoice.id);
    pushResult(results, "payment.summary.paid_amount_after_create", afterFirstPayment.summary.paidAmount === 100);
    pushResult(results, "payment.summary.balance_due_after_create", afterFirstPayment.summary.balanceDue === 200);
    pushResult(results, "invoice.status_partial_after_payment", afterFirstPayment.invoice.status === InvoiceStatus.PARTIALLY_PAID);

    const secondPayment = await createInvoicePayment(companyAdminSession as never, {
      invoiceId: primaryInvoice.id,
      amount: 200,
      paymentDate: new Date("2026-06-07"),
      mode: "UPI",
      referenceNumber: "QA-PAY-REF-2",
      notes: "second payment",
      status: PaymentStatus.PAID,
    });
    createdPaymentIds.push(secondPayment.payment.id);

    const afterSecondPayment = await listPaymentsForInvoice(companyAdminSession as never, primaryInvoice.id);
    pushResult(results, "payment.summary.paid_amount_after_second", afterSecondPayment.summary.paidAmount === 300);
    pushResult(results, "payment.summary.balance_due_after_second", afterSecondPayment.summary.balanceDue === 0);
    pushResult(results, "invoice.status_paid_after_full_payment", afterSecondPayment.invoice.status === InvoiceStatus.PAID);

    const overpaymentBlocked = await expectThrowMessage(() =>
      createInvoicePayment(companyAdminSession as never, {
        invoiceId: primaryInvoice.id,
        amount: 1,
        paymentDate: new Date("2026-06-08"),
        mode: "CASH",
        referenceNumber: "QA-PAY-REF-3",
        notes: "overpay",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "payment.overpayment_rejected", overpaymentBlocked.threw);

    const updatedPayment = await updateInvoicePayment(companyAdminSession as never, createdPayment.payment.id, {
      amount: 50,
      paymentDate: new Date("2026-06-09"),
      mode: "CARD",
      referenceNumber: "QA-PAY-REF-1B",
      notes: "updated",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "payment.update", Number(updatedPayment.payment.amount) === 50);

    const afterUpdate = await listPaymentsForInvoice(companyAdminSession as never, primaryInvoice.id);
    pushResult(results, "payment.summary_after_update", afterUpdate.summary.paidAmount === 250 && afterUpdate.summary.balanceDue === 50);

    const statusUpdated = await updateInvoicePaymentStatus(companyAdminSession as never, secondPayment.payment.id, {
      status: PaymentStatus.CANCELLED,
    });
    pushResult(results, "payment.status_update", statusUpdated.payment.status === PaymentStatus.CANCELLED);

    const afterStatusUpdate = await listPaymentsForInvoice(companyAdminSession as never, primaryInvoice.id);
    pushResult(results, "payment.cancelled_excluded_from_paid_total", afterStatusUpdate.summary.paidAmount === 50);

    const voidedFirst = await voidInvoicePayment(companyAdminSession as never, createdPayment.payment.id);
    pushResult(results, "payment.void", voidedFirst.payment.status === PaymentStatus.CANCELLED);

    const afterVoid = await listPaymentsForInvoice(companyAdminSession as never, primaryInvoice.id);
    pushResult(results, "payment.balance_reset_after_void", afterVoid.summary.paidAmount === 0 && afterVoid.summary.balanceDue === 300);
    pushResult(results, "invoice.status_reverts_when_no_paid_amount", afterVoid.invoice.status === InvoiceStatus.APPROVED);

    const crossTenantBlocked = await expectThrowMessage(() =>
      createInvoicePayment(companyAdminSession as never, {
        invoiceId: foreignInvoice.id,
        amount: 10,
        paymentDate: new Date("2026-06-10"),
        mode: "CASH",
        referenceNumber: "QA-PAY-XTEN",
        notes: "cross tenant",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.company_admin_cannot_record_foreign_invoice_payment", crossTenantBlocked.threw);

    const superForCompany = await createInvoicePayment(superSession as never, {
      invoiceId: primaryInvoice.id,
      amount: 120,
      paymentDate: new Date("2026-06-11"),
      mode: "BANK_TRANSFER",
      referenceNumber: "QA-PAY-SUPER",
      notes: "super",
      status: PaymentStatus.PAID,
    });
    createdPaymentIds.push(superForCompany.payment.id);
    pushResult(results, "tenant.super_admin_can_record_payment_platform_wide", superForCompany.payment.servicePartnerId === companyData.servicePartnerId);

    const foreignCannotUpdateCompanyPayment = await expectThrowMessage(() =>
      updateInvoicePayment(foreignSession as never, superForCompany.payment.id, {
        amount: 100,
        paymentDate: new Date("2026-06-12"),
        mode: "UPI",
        referenceNumber: "QA-PAY-FOREIGN",
        notes: "should fail",
        status: PaymentStatus.PAID,
      })
    );
    pushResult(results, "tenant.foreign_user_cannot_update_company_payment", foreignCannotUpdateCompanyPayment.threw);

    const validationZeroAmount = createPaymentSchema.safeParse({
      invoiceId: primaryInvoice.id,
      amount: 0,
      paymentDate: new Date("2026-06-12"),
      mode: "CASH",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "validation.zero_amount_rejected", !validationZeroAmount.success);

    const validationNegativeAmount = createPaymentSchema.safeParse({
      invoiceId: primaryInvoice.id,
      amount: -1,
      paymentDate: new Date("2026-06-12"),
      mode: "CASH",
      status: PaymentStatus.PAID,
    });
    pushResult(results, "validation.negative_amount_rejected", !validationNegativeAmount.success);

    const noReadCanRead = await hasPermission(noReadSession as never, "payments.read");
    const readOnlyCanCreate = await hasPermission(readOnlySession as never, "payments.create");
    const readOnlyCanUpdate = await hasPermission(readOnlySession as never, "payments.update");
    const readOnlyCanDelete = await hasPermission(readOnlySession as never, "payments.delete");
    const readOnlyCanStatusUpdate = await hasPermission(readOnlySession as never, "payments.status.update");
    pushResult(results, "permissions.user_without_payments_read_cannot_read", !noReadCanRead);
    pushResult(results, "permissions.user_without_payments_create_cannot_create", !readOnlyCanCreate);
    pushResult(results, "permissions.user_without_payments_update_cannot_update", !readOnlyCanUpdate);
    pushResult(results, "permissions.user_without_payments_delete_cannot_delete", !readOnlyCanDelete);
    pushResult(results, "permissions.user_without_payments_status_update_cannot_status_update", !readOnlyCanStatusUpdate);

    const paymentActionsSource = readFileSync("features/payments/actions/payment.actions.ts", "utf8");
    const invoiceDetailSource = readFileSync("app/(dashboard)/invoices/[id]/page.tsx", "utf8");
    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");
    pushResult(results, "permissions.payment_action_guard_create", paymentActionsSource.includes('requirePermission("payments.create")'));
    pushResult(results, "permissions.payment_action_guard_update", paymentActionsSource.includes('requirePermission("payments.update")'));
    pushResult(results, "permissions.payment_action_guard_delete", paymentActionsSource.includes('requirePermission("payments.delete")'));
    pushResult(
      results,
      "permissions.payment_action_guard_status_update",
      paymentActionsSource.includes('requirePermission("payments.status.update")')
    );
    pushResult(
      results,
      "integration.invoice_detail_payment_summary",
      invoiceDetailSource.includes("PaymentSummaryCard") || invoiceDetailSource.includes("Payment Summary")
    );
    pushResult(results, "integration.invoice_detail_payment_history", invoiceDetailSource.includes("Payment History"));

    const adminNav = await getNavigationForSession(companyAdminSession as never);
    const adminNavKeys = new Set(flattenNavKeys(adminNav));
    pushResult(results, "navigation.no_standalone_payments_nav", !adminNavKeys.has("payments"));
    pushResult(
      results,
      "navigation.payments_nav_seed_inactive",
      baselineSource.includes('{ key: "payments", label: "Payments", href: "#", sortOrder: 25, permissionKey: "payments.read", isActive: false }')
    );
    pushResult(results, "navigation.invoice_route_exists", existsSync("app/(dashboard)/invoices/[id]/page.tsx"));
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
