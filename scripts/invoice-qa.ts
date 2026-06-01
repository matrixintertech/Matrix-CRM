import { existsSync, readFileSync } from "node:fs";
import {
  InvoiceStatus,
  PrismaClient,
  PurchaseOrderStatus,
  RfqStatus,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
  VendorStatus,
} from "@prisma/client";

import {
  createInvoice,
  getInvoiceById,
  listInvoices,
  softDeleteInvoice,
  updateInvoice,
  updateInvoiceStatus,
} from "../features/invoices/services/invoice.service";
import { invoiceUpsertSchema } from "../features/invoices/validations";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { createPurchaseOrder } from "../features/purchase-orders/services/purchase-order.service";
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
  clientId: string;
  serviceRequestId: string;
  serviceRequestAltId: string;
  categoryId: string;
  itemId: string;
  itemAltId: string;
};

const QA_PREFIX = "qa.invoice";
const COMPANY_CODE = "QAINVCOMP";
const FOREIGN_CODE = "QAINVFORE";
const REQUIRED_PERMISSION_KEYS = [
  "invoices.read",
  "invoices.create",
  "invoices.update",
  "invoices.delete",
  "invoices.status.update",
  "invoices.send",
  "invoices.approve",
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
  const clientCode = `${input.prefix}-CL-001`;
  const categoryCode = `${input.prefix}-CAT-001`;
  const itemCode = `${input.prefix}-ITM-001`;
  const itemAltCode = `${input.prefix}-ITM-002`;
  const serviceNumber = `${input.prefix}-SR-001`;
  const serviceNumberAlt = `${input.prefix}-SR-002`;

  const client = await prisma.client.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: clientCode,
      },
    },
    update: {
      name: `${input.prefix} Client`,
      status: "ACTIVE",
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: clientCode,
      name: `${input.prefix} Client`,
      status: "ACTIVE",
    },
  });

  const category = await prisma.category.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: categoryCode,
      },
    },
    update: {
      name: `${input.prefix} Category`,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: categoryCode,
      name: `${input.prefix} Category`,
    },
  });

  const item = await prisma.item.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: itemCode,
      },
    },
    update: {
      categoryId: category.id,
      name: `${input.prefix} Item One`,
      unit: "NOS",
      active: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      categoryId: category.id,
      code: itemCode,
      name: `${input.prefix} Item One`,
      unit: "NOS",
      active: true,
    },
  });

  const itemAlt = await prisma.item.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: itemAltCode,
      },
    },
    update: {
      categoryId: category.id,
      name: `${input.prefix} Item Two`,
      unit: "NOS",
      active: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      categoryId: category.id,
      code: itemAltCode,
      name: `${input.prefix} Item Two`,
      unit: "NOS",
      active: true,
    },
  });

  const serviceRequest = await prisma.serviceRequest.upsert({
    where: {
      servicePartnerId_serviceNumber: {
        servicePartnerId: input.servicePartnerId,
        serviceNumber,
      },
    },
    update: {
      clientId: client.id,
      createdByUserId: input.createdByUserId,
      title: `${input.prefix} Service Request One`,
      description: "QA invoice service request one",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      createdByUserId: input.createdByUserId,
      serviceNumber,
      title: `${input.prefix} Service Request One`,
      description: "QA invoice service request one",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });

  const serviceRequestAlt = await prisma.serviceRequest.upsert({
    where: {
      servicePartnerId_serviceNumber: {
        servicePartnerId: input.servicePartnerId,
        serviceNumber: serviceNumberAlt,
      },
    },
    update: {
      clientId: client.id,
      createdByUserId: input.createdByUserId,
      title: `${input.prefix} Service Request Two`,
      description: "QA invoice service request two",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      createdByUserId: input.createdByUserId,
      serviceNumber: serviceNumberAlt,
      title: `${input.prefix} Service Request Two`,
      description: "QA invoice service request two",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });

  return {
    servicePartnerId: input.servicePartnerId,
    clientId: client.id,
    serviceRequestId: serviceRequest.id,
    serviceRequestAltId: serviceRequestAlt.id,
    categoryId: category.id,
    itemId: item.id,
    itemAltId: itemAlt.id,
  };
}

async function ensureVendor(input: {
  servicePartnerId: string;
  code: string;
  name: string;
  status: VendorStatus;
}) {
  return prisma.vendor.upsert({
    where: {
      servicePartnerId_code: {
        servicePartnerId: input.servicePartnerId,
        code: input.code,
      },
    },
    update: {
      name: input.name,
      status: input.status,
      deletedAt: null,
      isVerified: input.status === VendorStatus.ACTIVE,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      code: input.code,
      name: input.name,
      status: input.status,
      isVerified: input.status === VendorStatus.ACTIVE,
    },
  });
}

async function ensureRfqForInvoice(input: {
  servicePartnerId: string;
  serviceRequestId: string;
  vendorId: string;
  itemId: string;
  rfqNumber: string;
}) {
  const rfq = await prisma.rfq.upsert({
    where: {
      servicePartnerId_rfqNumber: {
        servicePartnerId: input.servicePartnerId,
        rfqNumber: input.rfqNumber,
      },
    },
    update: {
      serviceRequestId: input.serviceRequestId,
      title: "QA Invoice RFQ",
      status: RfqStatus.QUOTING,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      serviceRequestId: input.serviceRequestId,
      rfqNumber: input.rfqNumber,
      title: "QA Invoice RFQ",
      status: RfqStatus.QUOTING,
    },
  });

  await prisma.rfqItem.deleteMany({ where: { rfqId: rfq.id } });
  await prisma.rfqVendor.deleteMany({ where: { rfqId: rfq.id } });

  await prisma.rfqItem.create({
    data: {
      rfqId: rfq.id,
      itemId: input.itemId,
      quantity: 1,
      specs: "QA Invoice RFQ spec",
    },
  });
  await prisma.rfqVendor.create({
    data: {
      rfqId: rfq.id,
      vendorId: input.vendorId,
      status: "INVITED",
    },
  });

  return rfq;
}

async function cleanupQaRecords(input: { invoiceIds: string[]; purchaseOrderIds: string[]; rfqIds: string[] }) {
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

  if (input.rfqIds.length > 0) {
    await prisma.rfqItem.deleteMany({
      where: {
        rfqId: { in: input.rfqIds },
      },
    });
    await prisma.rfqVendor.deleteMany({
      where: {
        rfqId: { in: input.rfqIds },
      },
    });
  }
}

async function main() {
  const results: QAResult[] = [];
  const createdInvoiceIds: string[] = [];
  const createdPurchaseOrderIds: string[] = [];
  const trackedRfqIds: string[] = [];

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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Invoice Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Invoice Foreign");

    const companyAdminRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: companyPartner.id,
        key: "company_admin",
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
      },
    });
    const managerRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: companyPartner.id,
        key: "manager",
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
      },
    });
    const foreignManagerRole = await prisma.role.findFirst({
      where: {
        servicePartnerId: foreignPartner.id,
        key: "manager",
        deletedAt: null,
      },
      select: {
        id: true,
        key: true,
      },
    });
    if (!companyAdminRole || !managerRole || !foreignManagerRole) {
      throw new Error("QA tenant roles could not be resolved.");
    }

    const companyAdminUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyAdminRole.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      name: "QA Invoice Admin",
      phone: "+919952000001",
      status: UserStatus.ACTIVE,
    });
    const readOnlyUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.readonly@matrixcrm.local`,
      name: "QA Invoice Read Only",
      phone: "+919952000002",
      status: UserStatus.ACTIVE,
    });
    const noReadUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noread@matrixcrm.local`,
      name: "QA Invoice No Read",
      phone: "+919952000003",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Invoice Foreign",
      phone: "+919952000004",
      status: UserStatus.ACTIVE,
    });

    await Promise.all([
      replaceDirectPermissions({
        userId: companyAdminUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [
          "invoices.read",
          "invoices.create",
          "invoices.update",
          "invoices.delete",
          "invoices.status.update",
          "invoices.send",
          "invoices.approve",
          "purchase_orders.read",
          "purchase_orders.create",
          "purchase_orders.update",
          "rfq.read",
          "vendors.read",
          "service_requests.read",
          "items.read",
        ],
      }),
      replaceDirectPermissions({
        userId: readOnlyUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["invoices.read"],
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
        permissionKeys: ["invoices.read", "invoices.create", "invoices.update"],
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
        prefix: "QAINVCO",
        createdByUserId: companyAdminUser.id,
      }),
      ensureTenantData({
        servicePartnerId: foreignPartner.id,
        prefix: "QAINVFO",
        createdByUserId: foreignUser.id,
      }),
    ]);

    const vendorPrimary = await ensureVendor({
      servicePartnerId: companyPartner.id,
      code: "QAINV-V001",
      name: "QA Invoice Vendor One",
      status: VendorStatus.ACTIVE,
    });
    const vendorSecondary = await ensureVendor({
      servicePartnerId: companyPartner.id,
      code: "QAINV-V002",
      name: "QA Invoice Vendor Two",
      status: VendorStatus.ACTIVE,
    });
    const vendorInactive = await ensureVendor({
      servicePartnerId: companyPartner.id,
      code: "QAINV-V003",
      name: "QA Invoice Vendor Inactive",
      status: VendorStatus.INACTIVE,
    });
    const vendorForeign = await ensureVendor({
      servicePartnerId: foreignPartner.id,
      code: "QAINV-VF01",
      name: "QA Invoice Vendor Foreign",
      status: VendorStatus.ACTIVE,
    });

    const rfqCompany = await ensureRfqForInvoice({
      servicePartnerId: companyPartner.id,
      serviceRequestId: companyData.serviceRequestId,
      vendorId: vendorPrimary.id,
      itemId: companyData.itemId,
      rfqNumber: "QAINV-RFQ-001",
    });
    trackedRfqIds.push(rfqCompany.id);

    const createdPo = await createPurchaseOrder(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      rfqId: rfqCompany.id,
      serviceRequestId: companyData.serviceRequestId,
      vendorId: vendorPrimary.id,
      status: PurchaseOrderStatus.APPROVED,
      orderDate: new Date("2026-06-01"),
      expectedDate: new Date("2026-06-10"),
      notes: "QA invoice source PO",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 2,
          unitRate: 100,
          taxPercent: 18,
        },
      ],
    });
    createdPurchaseOrderIds.push(createdPo.id);

    const foreignPo = await createPurchaseOrder(superSession as never, {
      servicePartnerId: foreignData.servicePartnerId,
      rfqId: undefined,
      serviceRequestId: foreignData.serviceRequestId,
      vendorId: vendorForeign.id,
      status: PurchaseOrderStatus.APPROVED,
      orderDate: new Date("2026-06-01"),
      expectedDate: new Date("2026-06-10"),
      notes: "QA foreign PO",
      items: [
        {
          itemId: foreignData.itemId,
          quantity: 1,
          unitRate: 150,
          taxPercent: 0,
        },
      ],
    });
    createdPurchaseOrderIds.push(foreignPo.id);

    const createdInvoice = await createInvoice(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: createdPo.id,
      rfqId: rfqCompany.id,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: new Date("2026-06-20"),
      notes: "QA create invoice",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 2,
          unitRate: 100,
          taxPercent: 18,
        },
      ],
    });
    createdInvoiceIds.push(createdInvoice.id);
    pushResult(results, "invoice.create_from_po", createdInvoice.purchaseOrderId === createdPo.id);
    pushResult(results, "invoice.number_generation_safe", /^INV-[A-Z0-9]{1,6}-\d{8}-\d{4}$/.test(createdInvoice.invoiceNumber));
    pushResult(
      results,
      "invoice.total_calculation",
      Number(createdInvoice.subtotal) === 200 && Number(createdInvoice.taxTotal) === 36 && Number(createdInvoice.grandTotal) === 236
    );

    const updatedInvoice = await updateInvoice(companyAdminSession as never, createdInvoice.id, {
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: createdPo.id,
      rfqId: rfqCompany.id,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.SUBMITTED,
      invoiceDate: new Date("2026-06-03"),
      dueDate: new Date("2026-06-25"),
      notes: "QA update invoice",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 1.5,
          unitRate: 200,
          taxPercent: 0,
        },
        {
          itemId: companyData.itemAltId,
          quantity: 2,
          unitRate: 50,
          taxPercent: 10,
        },
      ],
    });
    pushResult(results, "invoice.update", updatedInvoice.status === InvoiceStatus.SUBMITTED);

    const updatedInvoiceDetail = await getInvoiceById(companyAdminSession as never, createdInvoice.id);
    pushResult(results, "invoice.line_add_and_multiple_lines", (updatedInvoiceDetail?.items.length ?? 0) === 2);
    pushResult(results, "invoice.server_totals_after_update", Number(updatedInvoiceDetail?.grandTotal ?? 0) === 410);

    const statusApprovalPending = await updateInvoiceStatus(companyAdminSession as never, createdInvoice.id, InvoiceStatus.APPROVAL_PENDING);
    pushResult(results, "invoice.status_update", statusApprovalPending.status === InvoiceStatus.APPROVAL_PENDING);
    const statusApproved = await updateInvoiceStatus(companyAdminSession as never, createdInvoice.id, InvoiceStatus.APPROVED);
    pushResult(results, "invoice.approve_status_update", statusApproved.status === InvoiceStatus.APPROVED && Boolean(statusApproved.approvedAt));

    const invalidStatusTransition = await expectThrowMessage(() =>
      updateInvoiceStatus(companyAdminSession as never, createdInvoice.id, InvoiceStatus.DRAFT)
    );
    pushResult(results, "invoice.invalid_status_rejected", invalidStatusTransition.threw);

    const markPaid = await updateInvoiceStatus(companyAdminSession as never, createdInvoice.id, InvoiceStatus.PAID);
    pushResult(results, "invoice.mark_paid", markPaid.status === InvoiceStatus.PAID);

    const editPaidBlocked = await expectThrowMessage(() =>
      updateInvoice(companyAdminSession as never, createdInvoice.id, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorPrimary.id,
        purchaseOrderId: createdPo.id,
        rfqId: rfqCompany.id,
        serviceRequestId: companyData.serviceRequestId,
        status: InvoiceStatus.PAID,
        invoiceDate: new Date("2026-06-03"),
        dueDate: new Date("2026-06-25"),
        notes: "should fail edit paid",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 10,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "invoice.paid_invoice_edit_blocked", editPaidBlocked.threw);

    await softDeleteInvoice(companyAdminSession as never, createdInvoice.id);
    const listAfterDelete = await listInvoices(companyAdminSession as never, { q: createdInvoice.invoiceNumber, page: 1, pageSize: 20 });
    pushResult(results, "invoice.soft_delete_excluded_from_list", listAfterDelete.invoices.length === 0);

    const crossTenantVendorBlocked = await expectThrowMessage(() =>
      createInvoice(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorForeign.id,
        purchaseOrderId: undefined,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "cross vendor",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.vendor_mismatch_blocked", crossTenantVendorBlocked.threw);

    const inactiveVendorBlocked = await expectThrowMessage(() =>
      createInvoice(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorInactive.id,
        purchaseOrderId: undefined,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "inactive vendor",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.inactive_vendor_blocked", inactiveVendorBlocked.threw);

    const crossTenantItemBlocked = await expectThrowMessage(() =>
      createInvoice(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorPrimary.id,
        purchaseOrderId: undefined,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "cross item",
        items: [
          {
            itemId: foreignData.itemId,
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.item_mismatch_blocked", crossTenantItemBlocked.threw);

    const crossTenantServiceRequestBlocked = await expectThrowMessage(() =>
      createInvoice(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorPrimary.id,
        purchaseOrderId: undefined,
        rfqId: undefined,
        serviceRequestId: foreignData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "cross service request",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.service_request_mismatch_blocked", crossTenantServiceRequestBlocked.threw);

    const crossTenantPoBlocked = await expectThrowMessage(() =>
      createInvoice(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorPrimary.id,
        purchaseOrderId: foreignPo.id,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "cross po",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.purchase_order_mismatch_blocked", crossTenantPoBlocked.threw);

    const superMismatchedVendorBlocked = await expectThrowMessage(() =>
      createInvoice(superSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        vendorId: vendorForeign.id,
        purchaseOrderId: undefined,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "super mismatch",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.super_admin_mismatched_link_blocked", superMismatchedVendorBlocked.threw);

    const foreignInvoice = await createInvoice(superSession as never, {
      servicePartnerId: foreignData.servicePartnerId,
      vendorId: vendorForeign.id,
      purchaseOrderId: foreignPo.id,
      rfqId: undefined,
      serviceRequestId: foreignData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "foreign invoice",
      items: [
        {
          itemId: foreignData.itemId,
          quantity: 1,
          unitRate: 50,
          taxPercent: 0,
        },
      ],
    });
    createdInvoiceIds.push(foreignInvoice.id);
    pushResult(results, "tenant.super_admin_platform_wide_valid_invoice", foreignInvoice.servicePartnerId === foreignData.servicePartnerId);

    const companyCannotUpdateForeignInvoice = await expectThrowMessage(() =>
      updateInvoice(companyAdminSession as never, foreignInvoice.id, {
        servicePartnerId: foreignData.servicePartnerId,
        vendorId: vendorForeign.id,
        purchaseOrderId: foreignPo.id,
        rfqId: undefined,
        serviceRequestId: foreignData.serviceRequestId,
        status: InvoiceStatus.DRAFT,
        invoiceDate: new Date("2026-06-02"),
        dueDate: undefined,
        notes: "should fail",
        items: [
          {
            itemId: foreignData.itemId,
            quantity: 1,
            unitRate: 50,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.company_admin_cannot_update_foreign_invoice", companyCannotUpdateForeignInvoice.threw);

    const validationNegativeQuantity = invoiceUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: undefined,
      rfqId: undefined,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "validation",
      items: [
        {
          itemId: companyData.itemId,
          quantity: -1,
          unitRate: 100,
          taxPercent: 0,
        },
      ],
    });
    pushResult(results, "validation.negative_quantity_rejected", !validationNegativeQuantity.success);

    const validationZeroQuantity = invoiceUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: undefined,
      rfqId: undefined,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "validation",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 0,
          unitRate: 100,
          taxPercent: 0,
        },
      ],
    });
    pushResult(results, "validation.zero_quantity_rejected", !validationZeroQuantity.success);

    const validationNegativeRate = invoiceUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: undefined,
      rfqId: undefined,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "validation",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 1,
          unitRate: -1,
          taxPercent: 0,
        },
      ],
    });
    pushResult(results, "validation.negative_unit_rate_rejected", !validationNegativeRate.success);

    const validationTaxLow = invoiceUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: undefined,
      rfqId: undefined,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "validation",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 1,
          unitRate: 1,
          taxPercent: -1,
        },
      ],
    });
    pushResult(results, "validation.tax_lt_0_rejected", !validationTaxLow.success);

    const validationTaxHigh = invoiceUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: undefined,
      rfqId: undefined,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "validation",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 1,
          unitRate: 1,
          taxPercent: 101,
        },
      ],
    });
    pushResult(results, "validation.tax_gt_100_rejected", !validationTaxHigh.success);

    const validationDecimalQuantity = invoiceUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      vendorId: vendorPrimary.id,
      purchaseOrderId: undefined,
      rfqId: undefined,
      serviceRequestId: companyData.serviceRequestId,
      status: InvoiceStatus.DRAFT,
      invoiceDate: new Date("2026-06-02"),
      dueDate: undefined,
      notes: "validation",
      items: [
        {
          itemId: companyData.itemId,
          quantity: 1.25,
          unitRate: 100,
          taxPercent: 0,
        },
      ],
    });
    pushResult(results, "validation.decimal_quantity_allowed", validationDecimalQuantity.success);

    const noCreateCanCreate = await hasPermission(readOnlySession as never, "invoices.create");
    const noUpdateCanUpdate = await hasPermission(readOnlySession as never, "invoices.update");
    const noDeleteCanDelete = await hasPermission(readOnlySession as never, "invoices.delete");
    const noStatusCanUpdate = await hasPermission(readOnlySession as never, "invoices.status.update");
    const noReadCanRead = await hasPermission(noReadSession as never, "invoices.read");
    pushResult(results, "permissions.user_without_invoices_create_cannot_create", !noCreateCanCreate);
    pushResult(results, "permissions.user_without_invoices_update_cannot_update", !noUpdateCanUpdate);
    pushResult(results, "permissions.user_without_invoices_delete_cannot_delete", !noDeleteCanDelete);
    pushResult(results, "permissions.user_without_invoices_status_update_cannot_status_update", !noStatusCanUpdate);
    pushResult(results, "permissions.user_without_invoices_read_cannot_read", !noReadCanRead);

    const invoiceActionSource = readFileSync("features/invoices/actions/invoice.actions.ts", "utf8");
    const invoicePageSource = readFileSync("app/(dashboard)/invoices/page.tsx", "utf8");
    const poDetailSource = readFileSync("app/(dashboard)/purchase-orders/[id]/page.tsx", "utf8");
    pushResult(results, "permissions.invoice_actions_guard_create", invoiceActionSource.includes('requirePermission("invoices.create")'));
    pushResult(results, "permissions.invoice_actions_guard_update", invoiceActionSource.includes('requirePermission("invoices.update")'));
    pushResult(results, "permissions.invoice_actions_guard_delete", invoiceActionSource.includes('requirePermission("invoices.delete")'));
    pushResult(
      results,
      "permissions.invoice_actions_guard_status_update",
      invoiceActionSource.includes('requirePermission("invoices.status.update")')
    );
    pushResult(results, "permissions.invoice_page_guard_read", invoicePageSource.includes('requirePermission("invoices.read")'));
    pushResult(
      results,
      "integration.po_detail_create_invoice_permission_gated",
      poDetailSource.includes('hasPermission(session, "invoices.create")') && poDetailSource.includes("/invoices/new?purchaseOrderId=")
    );

    const companyNav = await getNavigationForSession(companyAdminSession as never);
    const noReadNav = await getNavigationForSession(noReadSession as never);
    const companyNavKeys = new Set(flattenNavKeys(companyNav));
    const noReadNavKeys = new Set(flattenNavKeys(noReadNav));
    pushResult(results, "navigation.invoices_visible_with_read_permission", companyNavKeys.has("invoice-list"));
    pushResult(results, "navigation.invoices_hidden_without_read_permission", !noReadNavKeys.has("invoice-list"));

    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");
    pushResult(
      results,
      "navigation.invoice_nav_link_active",
      baselineSource.includes('{ key: "invoice-list", label: "Invoice List", href: "/invoices", sortOrder: 30, permissionKey: "invoices.read", isActive: true }')
    );
    pushResult(
      results,
      "navigation.vendor_payment_still_inactive",
      baselineSource.includes(
        '{ key: "vendor-payments-list", label: "Vendors Payment List", href: "#", sortOrder: 31, permissionKey: "vendor_payments.read", isActive: false }'
      )
    );

    const dashboardSource = readFileSync("app/(dashboard)/page.tsx", "utf8");
    pushResult(results, "dashboard.invoice_kpi_permission_gated", dashboardSource.includes('can("invoices.read") ? prisma.invoice.count'));
    pushResult(
      results,
      "dashboard.new_invoice_quick_action_permission_gated",
      dashboardSource.includes('title: "New Invoice"') && dashboardSource.includes('permission: "invoices.create"')
    );
    pushResult(
      results,
      "dashboard.invoice_count_tenant_scoped_non_super_admin",
      dashboardSource.includes('prisma.invoice.count({ where: scopeByTenant(session, { deletedAt: null }) })')
    );

    pushResult(results, "navigation.invoice_routes_exist", existsSync("app/(dashboard)/invoices/page.tsx"));
    pushResult(results, "navigation.invoice_detail_route_exists", existsSync("app/(dashboard)/invoices/[id]/page.tsx"));
    pushResult(results, "navigation.invoice_edit_route_exists", existsSync("app/(dashboard)/invoices/[id]/edit/page.tsx"));
  } finally {
    await cleanupQaRecords({
      invoiceIds: createdInvoiceIds,
      purchaseOrderIds: createdPurchaseOrderIds,
      rfqIds: trackedRfqIds,
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
