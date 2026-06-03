import { existsSync, readFileSync } from "node:fs";
import {
  PrismaClient,
  PurchaseOrderStatus,
  RfqStatus,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
  VendorStatus,
} from "@prisma/client";

import {
  createPurchaseOrder,
  listPurchaseOrders,
  softDeletePurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from "../features/purchase-orders/services/purchase-order.service";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
import { hasPermission } from "../lib/auth/permissions";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";
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
  clientId: string;
  serviceRequestId: string;
  serviceRequestAltId: string;
  categoryId: string;
  itemId: string;
  itemAltId: string;
};

const QA_PREFIX = "qa.po";
const COMPANY_CODE = "QAPOCOMP";
const FOREIGN_CODE = "QAPOFORE";
const REQUIRED_PERMISSION_KEYS = [
  "purchase_orders.read",
  "purchase_orders.create",
  "purchase_orders.update",
  "purchase_orders.delete",
  "purchase_orders.status.update",
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
      description: "QA PO service request one",
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
      description: "QA PO service request one",
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
      description: "QA PO service request two",
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
      description: "QA PO service request two",
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

async function ensureRfqForPo(input: {
  servicePartnerId: string;
  serviceRequestId: string;
  vendorId: string;
  itemId: string;
}) {
  const rfqNumber = "QAPO-RFQ-001";
  const rfq = await prisma.rfq.upsert({
    where: {
      servicePartnerId_rfqNumber: {
        servicePartnerId: input.servicePartnerId,
        rfqNumber,
      },
    },
    update: {
      serviceRequestId: input.serviceRequestId,
      title: "QA PO RFQ",
      status: RfqStatus.QUOTING,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      serviceRequestId: input.serviceRequestId,
      rfqNumber,
      title: "QA PO RFQ",
      status: RfqStatus.QUOTING,
    },
  });

  await prisma.rfqItem.deleteMany({
    where: {
      rfqId: rfq.id,
    },
  });
  await prisma.rfqVendor.deleteMany({
    where: {
      rfqId: rfq.id,
    },
  });

  await prisma.rfqItem.create({
    data: {
      rfqId: rfq.id,
      itemId: input.itemId,
      quantity: 1,
      specs: "QA PO RFQ spec",
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

async function cleanupQaRecords(input: { purchaseOrderIds: string[]; rfqIds: string[] }) {
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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Purchase Order Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Purchase Order Foreign");

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
      name: "QA Purchase Order Admin",
      phone: "+919951000001",
      status: UserStatus.ACTIVE,
    });
    const noOpsUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noops@matrixcrm.local`,
      name: "QA Purchase Order No Ops",
      phone: "+919951000002",
      status: UserStatus.ACTIVE,
    });
    const noReadUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noread@matrixcrm.local`,
      name: "QA Purchase Order No Read",
      phone: "+919951000003",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Purchase Order Foreign",
      phone: "+919951000004",
      status: UserStatus.ACTIVE,
    });

    await Promise.all([
      replaceDirectPermissions({
        userId: companyAdminUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: [
          "purchase_orders.read",
          "purchase_orders.create",
          "purchase_orders.update",
          "purchase_orders.delete",
          "purchase_orders.status.update",
          "rfq.read",
          "vendors.read",
          "service_requests.read",
        ],
      }),
      replaceDirectPermissions({
        userId: noOpsUser.id,
        servicePartnerId: companyPartner.id,
        assignedByUserId: superAdmin.id,
        permissionKeys: ["purchase_orders.read"],
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
        permissionKeys: ["purchase_orders.read", "purchase_orders.create", "purchase_orders.update"],
      }),
    ]);

    const companyAdminSession = toSession({
      id: companyAdminUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyAdminRole.key],
      isSuperAdmin: false,
    });
    const noOpsSession = toSession({
      id: noOpsUser.id,
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
        prefix: "QAPOCO",
        createdByUserId: companyAdminUser.id,
      }),
      ensureTenantData({
        servicePartnerId: foreignPartner.id,
        prefix: "QAPOFO",
        createdByUserId: foreignUser.id,
      }),
    ]);

    const vendorPrimary = await ensureVendor({
      servicePartnerId: companyPartner.id,
      code: "QAPO-V001",
      name: "QA PO Vendor One",
      status: VendorStatus.ACTIVE,
    });
    const vendorSecondary = await ensureVendor({
      servicePartnerId: companyPartner.id,
      code: "QAPO-V002",
      name: "QA PO Vendor Two",
      status: VendorStatus.ACTIVE,
    });
    const vendorInactive = await ensureVendor({
      servicePartnerId: companyPartner.id,
      code: "QAPO-V003",
      name: "QA PO Vendor Inactive",
      status: VendorStatus.INACTIVE,
    });
    const vendorForeign = await ensureVendor({
      servicePartnerId: foreignPartner.id,
      code: "QAPO-VF01",
      name: "QA PO Vendor Foreign",
      status: VendorStatus.ACTIVE,
    });

    const rfqCompany = await ensureRfqForPo({
      servicePartnerId: companyPartner.id,
      serviceRequestId: companyData.serviceRequestId,
      vendorId: vendorPrimary.id,
      itemId: companyData.itemId,
    });
    trackedRfqIds.push(rfqCompany.id);

    const createdPo = await createPurchaseOrder(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      rfqId: rfqCompany.id,
      serviceRequestId: companyData.serviceRequestId,
      vendorId: vendorPrimary.id,
      status: PurchaseOrderStatus.DRAFT,
      orderDate: new Date("2026-06-01"),
      expectedDate: new Date("2026-06-10"),
      notes: "QA create PO",
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
    pushResult(results, "po.create", createdPo.servicePartnerId === companyData.servicePartnerId && createdPo.vendorId === vendorPrimary.id);
    pushResult(results, "po.total_calculation", Number(createdPo.subtotal) === 200 && Number(createdPo.taxTotal) === 36 && Number(createdPo.grandTotal) === 236);

    const updatedPo = await updatePurchaseOrder(companyAdminSession as never, createdPo.id, {
      servicePartnerId: companyData.servicePartnerId,
      rfqId: rfqCompany.id,
      serviceRequestId: companyData.serviceRequestId,
      vendorId: vendorPrimary.id,
      status: PurchaseOrderStatus.APPROVAL_PENDING,
      orderDate: new Date("2026-06-01"),
      expectedDate: new Date("2026-06-12"),
      notes: "QA update PO",
      items: [
        {
          itemId: companyData.itemAltId,
          quantity: 3,
          unitRate: 110,
          taxPercent: 10,
        },
      ],
    });
    pushResult(results, "po.update", updatedPo.status === PurchaseOrderStatus.APPROVAL_PENDING && Number(updatedPo.grandTotal) === 363);

    const approvedPo = await updatePurchaseOrderStatus(companyAdminSession as never, createdPo.id, PurchaseOrderStatus.APPROVED);
    pushResult(results, "po.status_update", approvedPo.status === PurchaseOrderStatus.APPROVED && Boolean(approvedPo.approvedAt));

    const invalidTransition = await expectThrowMessage(() =>
      updatePurchaseOrderStatus(companyAdminSession as never, createdPo.id, PurchaseOrderStatus.DRAFT)
    );
    pushResult(results, "po.invalid_status_transition_blocked", invalidTransition.threw);

    const crossTenantVendorBlocked = await expectThrowMessage(() =>
      createPurchaseOrder(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        vendorId: vendorForeign.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "cross vendor",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 100,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "po.cross_tenant_vendor_blocked", crossTenantVendorBlocked.threw);

    const inactiveVendorBlocked = await expectThrowMessage(() =>
      createPurchaseOrder(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        vendorId: vendorInactive.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "inactive vendor",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 100,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "po.inactive_vendor_blocked", inactiveVendorBlocked.threw);

    const crossTenantItemBlocked = await expectThrowMessage(() =>
      createPurchaseOrder(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        vendorId: vendorPrimary.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "cross item",
        items: [
          {
            itemId: foreignData.itemId,
            quantity: 1,
            unitRate: 100,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "po.cross_tenant_item_blocked", crossTenantItemBlocked.threw);

    const rfqVendorMismatchBlocked = await expectThrowMessage(() =>
      createPurchaseOrder(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        rfqId: rfqCompany.id,
        serviceRequestId: companyData.serviceRequestId,
        vendorId: vendorSecondary.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "rfq vendor mismatch",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 100,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "po.rfq_vendor_mismatch_blocked", rfqVendorMismatchBlocked.threw);

    const rfqServiceRequestMismatchBlocked = await expectThrowMessage(() =>
      createPurchaseOrder(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        rfqId: rfqCompany.id,
        serviceRequestId: companyData.serviceRequestAltId,
        vendorId: vendorPrimary.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "rfq sr mismatch",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 100,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "po.rfq_service_request_mismatch_blocked", rfqServiceRequestMismatchBlocked.threw);

    const foreignPo = await createPurchaseOrder(superSession as never, {
      servicePartnerId: foreignData.servicePartnerId,
      rfqId: undefined,
      serviceRequestId: foreignData.serviceRequestId,
      vendorId: vendorForeign.id,
      status: PurchaseOrderStatus.DRAFT,
      orderDate: new Date("2026-06-01"),
      expectedDate: undefined,
      notes: "foreign po",
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
    pushResult(results, "tenant.super_admin_create_cross_tenant_valid", foreignPo.servicePartnerId === foreignData.servicePartnerId);

    const companyCannotUpdateForeign = await expectThrowMessage(() =>
      updatePurchaseOrder(companyAdminSession as never, foreignPo.id, {
        servicePartnerId: foreignData.servicePartnerId,
        rfqId: undefined,
        serviceRequestId: foreignData.serviceRequestId,
        vendorId: vendorForeign.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "should fail",
        items: [
          {
            itemId: foreignData.itemId,
            quantity: 1,
            unitRate: 160,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.company_admin_cannot_update_foreign_po", companyCannotUpdateForeign.threw);

    const superMismatchedAssortmentBlocked = await expectThrowMessage(() =>
      createPurchaseOrder(superSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        rfqId: undefined,
        serviceRequestId: companyData.serviceRequestId,
        vendorId: vendorForeign.id,
        status: PurchaseOrderStatus.DRAFT,
        orderDate: new Date("2026-06-01"),
        expectedDate: undefined,
        notes: "super mismatch",
        items: [
          {
            itemId: companyData.itemId,
            quantity: 1,
            unitRate: 120,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.super_admin_mismatched_vendor_blocked", superMismatchedAssortmentBlocked.threw);

    await softDeletePurchaseOrder(companyAdminSession as never, createdPo.id);
    const listAfterDelete = await listPurchaseOrders(companyAdminSession as never, { q: createdPo.poNumber, page: 1, pageSize: 20 });
    pushResult(results, "po.list_excludes_soft_deleted", listAfterDelete.purchaseOrders.length === 0);

    const noOpsCanCreate = await hasPermission(noOpsSession as never, "purchase_orders.create");
    const noOpsCanUpdate = await hasPermission(noOpsSession as never, "purchase_orders.update");
    const noOpsCanDelete = await hasPermission(noOpsSession as never, "purchase_orders.delete");
    const noOpsCanStatusUpdate = await hasPermission(noOpsSession as never, "purchase_orders.status.update");
    const noReadCanRead = await hasPermission(noReadSession as never, "purchase_orders.read");
    pushResult(results, "permissions.user_without_purchase_orders_create_cannot_create", !noOpsCanCreate);
    pushResult(results, "permissions.user_without_purchase_orders_update_cannot_update", !noOpsCanUpdate);
    pushResult(results, "permissions.user_without_purchase_orders_delete_cannot_delete", !noOpsCanDelete);
    pushResult(results, "permissions.user_without_purchase_orders_status_update_cannot_status_update", !noOpsCanStatusUpdate);
    pushResult(results, "permissions.user_without_purchase_orders_read_cannot_read", !noReadCanRead);

    const purchaseOrderActionSource = readFileSync("features/purchase-orders/actions/purchase-order.actions.ts", "utf8");
    const purchaseOrderPageSource = readFileSync("app/(dashboard)/purchase-orders/page.tsx", "utf8");
    pushResult(
      results,
      "permissions.purchase_order_actions_guard_create",
      purchaseOrderActionSource.includes('requirePermission("purchase_orders.create")')
    );
    pushResult(
      results,
      "permissions.purchase_order_actions_guard_update",
      purchaseOrderActionSource.includes('requirePermission("purchase_orders.update")')
    );
    pushResult(
      results,
      "permissions.purchase_order_actions_guard_delete",
      purchaseOrderActionSource.includes('requirePermission("purchase_orders.delete")')
    );
    pushResult(
      results,
      "permissions.purchase_order_actions_guard_status_update",
      purchaseOrderActionSource.includes('requirePermission("purchase_orders.status.update")')
    );
    pushResult(
      results,
      "permissions.purchase_order_page_guard_read",
      purchaseOrderPageSource.includes('requirePermission("purchase_orders.read")')
    );

    const companyAdminNav = await getNavigationForSession(companyAdminSession as never);
    const noReadNav = await getNavigationForSession(noReadSession as never);
    const companyAdminNavKeys = new Set(flattenNavKeys(companyAdminNav));
    const noReadNavKeys = new Set(flattenNavKeys(noReadNav));
    pushResult(results, "navigation.po_visible_with_read_permission", companyAdminNavKeys.has("po-list"));
    pushResult(results, "navigation.po_hidden_without_read_permission", !noReadNavKeys.has("po-list"));

    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");
    pushResult(
      results,
      "navigation.po_nav_link_active",
      baselineSource.includes('{ key: "po-list", label: "PO List", href: "/purchase-orders", sortOrder: 29, permissionKey: "purchase_orders.read", isActive: true }')
    );
    pushResult(results, "navigation.purchase_order_routes_exist", existsSync("app/(dashboard)/purchase-orders/page.tsx"));
  } finally {
    await cleanupQaRecords({
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
