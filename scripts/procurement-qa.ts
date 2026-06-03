import { existsSync, readFileSync } from "node:fs";
import { PrismaClient, RfqStatus, ServicePartnerStatus, ServiceRequestStatus, UserStatus, VendorStatus } from "@prisma/client";

import {
  createRfq,
  listRfqs,
  sendRfqToVendors,
  softDeleteRfq,
  updateRfq,
  updateRfqStatus,
  updateRfqVendorQuote,
} from "../features/rfqs/services/rfq.service";
import {
  createVendor,
  getVendorById,
  listVendors,
  softDeleteVendor,
  updateVendor,
  updateVendorStatus,
} from "../features/vendors/services/vendor.service";
import { rfqUpsertSchema } from "../features/rfqs/validations";
import { vendorUpsertSchema } from "../features/vendors/validations";
import { hasPermission } from "../lib/auth/permissions";
import { getNavigationForSession } from "../features/navigation/services/navigation.service";
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
  branchId: string;
  serviceRequestId: string;
  categoryId: string;
  itemId: string;
};

type ThrowResult = {
  threw: boolean;
  message?: string;
};

const QA_PREFIX = "qa.procurement";
const COMPANY_CODE = "QAPCOMP";
const FOREIGN_CODE = "QAPFORE";
const REQUIRED_PERMISSION_KEYS = [
  "vendors.read",
  "vendors.create",
  "vendors.update",
  "vendors.delete",
  "rfq.read",
  "rfq.create",
  "rfq.update",
  "rfq.delete",
  "rfq.status.update",
  "rfq.send",
  "vendor_quotations.read",
  "vendor_quotations.create",
  "vendor_quotations.update",
  "vendor_quotations.delete",
] as const;

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

async function expectThrowMessage(fn: () => Promise<unknown>): Promise<ThrowResult> {
  try {
    await fn();
    return { threw: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { threw: true, message };
  }
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

type NavNode = {
  key: string;
  children: NavNode[];
};

function flattenNavKeys(items: NavNode[]): string[] {
  const result: string[] = [];
  const stack = [...items];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    result.push(current.key);
    if (Array.isArray(current.children)) {
      for (const child of current.children) {
        stack.push(child);
      }
    }
  }
  return result;
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
  const branchCode = `${input.prefix}-BR-001`;
  const serviceNumber = `${input.prefix}-SR-001`;
  const categoryCode = `${input.prefix}-CAT-001`;
  const itemCode = `${input.prefix}-ITM-001`;

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

  const branch = await prisma.branch.upsert({
    where: {
      clientId_code: {
        clientId: client.id,
        code: branchCode,
      },
    },
    update: {
      name: `${input.prefix} Branch`,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      code: branchCode,
      name: `${input.prefix} Branch`,
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
      name: `${input.prefix} Item`,
      unit: "NOS",
      active: true,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      categoryId: category.id,
      code: itemCode,
      name: `${input.prefix} Item`,
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
      branchId: branch.id,
      createdByUserId: input.createdByUserId,
      title: `${input.prefix} Service Request`,
      description: "QA procurement checks",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      clientId: client.id,
      branchId: branch.id,
      createdByUserId: input.createdByUserId,
      serviceNumber,
      title: `${input.prefix} Service Request`,
      description: "QA procurement checks",
      serviceType: "QA",
      status: ServiceRequestStatus.RAISED,
    },
  });

  return {
    servicePartnerId: input.servicePartnerId,
    clientId: client.id,
    branchId: branch.id,
    serviceRequestId: serviceRequest.id,
    categoryId: category.id,
    itemId: item.id,
  };
}

async function cleanupQaRecords(input: { serviceRequestIds: string[] }) {
  if (input.serviceRequestIds.length === 0) {
    return;
  }

  const rfqs = await prisma.rfq.findMany({
    where: {
      serviceRequestId: { in: input.serviceRequestIds },
    },
    select: {
      id: true,
    },
  });
  const rfqIds = rfqs.map((rfq) => rfq.id);
  if (rfqIds.length > 0) {
    await prisma.rfqItem.deleteMany({
      where: {
        rfqId: {
          in: rfqIds,
        },
      },
    });
    await prisma.rfqVendor.deleteMany({
      where: {
        rfqId: {
          in: rfqIds,
        },
      },
    });
    await prisma.rfq.deleteMany({
      where: {
        id: {
          in: rfqIds,
        },
      },
    });
  }
}

async function cleanupQaVendors(codes: string[]) {
  if (codes.length === 0) {
    return;
  }

  await prisma.vendor.deleteMany({
    where: {
      code: {
        in: codes,
      },
    },
  });
}

async function main() {
  const results: QAResult[] = [];
  const qaServiceRequestIds: string[] = [];
  const qaVendorCodes: string[] = [];

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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Procurement Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Procurement Foreign");

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
      },
    });
    if (!companyAdminRole || !managerRole || !foreignManagerRole) {
      throw new Error("QA tenant roles could not be resolved.");
    }

    const qaCompanyAdmin = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: companyAdminRole.id,
      email: `${QA_PREFIX}.companyadmin@matrixcrm.local`,
      name: "QA Procurement Company Admin",
      phone: "+919941000001",
      status: UserStatus.ACTIVE,
    });
    const qaNoOpsUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noops@matrixcrm.local`,
      name: "QA Procurement No Ops",
      phone: "+919941000002",
      status: UserStatus.ACTIVE,
    });
    const qaNoReadUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noread@matrixcrm.local`,
      name: "QA Procurement No Read",
      phone: "+919941000004",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Procurement Foreign User",
      phone: "+919941000003",
      status: UserStatus.ACTIVE,
    });

    const companyData = await ensureTenantData({
      servicePartnerId: companyPartner.id,
      prefix: "QAPTN",
      createdByUserId: qaCompanyAdmin.id,
    });
    const foreignData = await ensureTenantData({
      servicePartnerId: foreignPartner.id,
      prefix: "QAPTNF",
      createdByUserId: foreignUser.id,
    });
    qaServiceRequestIds.push(companyData.serviceRequestId, foreignData.serviceRequestId);

    await cleanupQaRecords({ serviceRequestIds: qaServiceRequestIds });
    await cleanupQaVendors(["QAV-001", "QAV-002", "QAV-F001"]);

    await replaceDirectPermissions({
      userId: qaCompanyAdmin.id,
      servicePartnerId: companyPartner.id,
      assignedByUserId: superAdmin.id,
      permissionKeys: [
        "service_requests.read",
        "items.read",
        "vendors.read",
        "vendors.create",
        "vendors.update",
        "vendors.delete",
        "rfq.read",
        "rfq.create",
        "rfq.update",
        "rfq.delete",
        "rfq.status.update",
        "rfq.send",
        "vendor_quotations.read",
        "vendor_quotations.update",
      ],
    });
    await replaceDirectPermissions({
      userId: qaNoOpsUser.id,
      servicePartnerId: companyPartner.id,
      assignedByUserId: superAdmin.id,
      permissionKeys: ["service_requests.read", "vendors.read", "rfq.read", "vendor_quotations.read"],
    });
    await replaceDirectPermissions({
      userId: qaNoReadUser.id,
      servicePartnerId: companyPartner.id,
      assignedByUserId: superAdmin.id,
      permissionKeys: ["service_requests.read"],
    });

    const companyAdminSession = toSession({
      id: qaCompanyAdmin.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [companyAdminRole.key],
      isSuperAdmin: false,
    });
    const noOpsSession = toSession({
      id: qaNoOpsUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [managerRole.key],
      isSuperAdmin: false,
    });
    const noReadSession = toSession({
      id: qaNoReadUser.id,
      servicePartnerId: companyPartner.id,
      roleKeys: [managerRole.key],
      isSuperAdmin: false,
    });

    const createdVendor = await createVendor(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      code: "QAV-001",
      name: "QA Vendor One",
      email: "qav1@matrixcrm.local",
      phone: "+919900000001",
      status: VendorStatus.PENDING_VERIFICATION,
      isVerified: false,
      gstNumber: "GSTQAV001",
      panNumber: "PANQAV001",
      address: "QA Street 1",
      city: "Mumbai",
      state: "MH",
      country: "India",
      postalCode: "400001",
      vendorType: "Distributor",
    });
    qaVendorCodes.push(createdVendor.code);
    pushResult(results, "vendors.create_vendor", createdVendor.servicePartnerId === companyData.servicePartnerId);

    const updatedVendor = await updateVendor(companyAdminSession as never, createdVendor.id, {
      servicePartnerId: companyData.servicePartnerId,
      code: "QAV-001",
      name: "QA Vendor One Updated",
      email: "qav1.updated@matrixcrm.local",
      phone: "+919900000009",
      status: VendorStatus.ACTIVE,
      isVerified: true,
      gstNumber: "GSTQAV001U",
      panNumber: "PANQAV001U",
      address: "QA Street 1 Updated",
      city: "Pune",
      state: "MH",
      country: "India",
      postalCode: "411001",
      vendorType: "OEM",
    });
    pushResult(results, "vendors.update_vendor", updatedVendor.name === "QA Vendor One Updated" && updatedVendor.isVerified);

    const statusUpdatedVendor = await updateVendorStatus(companyAdminSession as never, updatedVendor.id, VendorStatus.ACTIVE, true);
    pushResult(results, "vendors.status_update_vendor", statusUpdatedVendor.status === VendorStatus.ACTIVE && statusUpdatedVendor.isVerified);

    const secondVendor = await createVendor(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      code: "QAV-002",
      name: "QA Vendor Two",
      email: "qav2@matrixcrm.local",
      phone: "+919900000002",
      status: VendorStatus.ACTIVE,
      isVerified: true,
      gstNumber: undefined,
      panNumber: undefined,
      address: undefined,
      city: undefined,
      state: undefined,
      country: undefined,
      postalCode: undefined,
      vendorType: "Service",
    });
    qaVendorCodes.push(secondVendor.code);

    const foreignVendor = await createVendor(superSession as never, {
      servicePartnerId: foreignData.servicePartnerId,
      code: "QAV-F001",
      name: "QA Vendor Foreign",
      email: "qavf@matrixcrm.local",
      phone: "+919900000003",
      status: VendorStatus.ACTIVE,
      isVerified: true,
      gstNumber: undefined,
      panNumber: undefined,
      address: undefined,
      city: undefined,
      state: undefined,
      country: undefined,
      postalCode: undefined,
      vendorType: "Foreign",
    });
    qaVendorCodes.push(foreignVendor.code);

    const duplicateVendorResult = await expectThrowMessage(() =>
      createVendor(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        code: "QAV-001",
        name: "QA Vendor One Duplicate",
        email: "qav1.duplicate@matrixcrm.local",
        phone: "+919900000011",
        status: VendorStatus.ACTIVE,
        isVerified: false,
        gstNumber: undefined,
        panNumber: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        country: undefined,
        postalCode: undefined,
        vendorType: undefined,
      })
    );
    pushResult(results, "vendors.duplicate_vendor_code_clean_error", duplicateVendorResult.threw);

    const vendorMissingRequired = vendorUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      code: "",
      name: "",
      email: "qa.vendor@matrixcrm.local",
      phone: "+919900000004",
      status: VendorStatus.ACTIVE,
      isVerified: false,
    });
    pushResult(results, "vendors.missing_required_rejected", !vendorMissingRequired.success);

    const vendorInvalidEmail = vendorUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      code: "QAV-VAL",
      name: "QA Vendor Validation",
      email: "invalid-email",
      phone: "+919900000005",
      status: VendorStatus.ACTIVE,
      isVerified: false,
    });
    pushResult(results, "vendors.invalid_email_rejected", !vendorInvalidEmail.success);

    const vendorSearchByCode = await listVendors(companyAdminSession as never, { q: "QAV-001", page: 1, pageSize: 20 });
    const vendorSearchByName = await listVendors(companyAdminSession as never, { q: "Vendor One Updated", page: 1, pageSize: 20 });
    const vendorSearchByEmail = await listVendors(companyAdminSession as never, { q: "qav1.updated@matrixcrm.local", page: 1, pageSize: 20 });
    const vendorSearchByPhone = await listVendors(companyAdminSession as never, { q: "+919900000009", page: 1, pageSize: 20 });
    const vendorSearchByGst = await listVendors(companyAdminSession as never, { q: "GSTQAV001U", page: 1, pageSize: 20 });
    pushResult(
      results,
      "vendors.search_vendor",
      vendorSearchByCode.vendors.some((vendor) => vendor.id === createdVendor.id) &&
        vendorSearchByName.vendors.some((vendor) => vendor.id === createdVendor.id) &&
        vendorSearchByEmail.vendors.some((vendor) => vendor.id === createdVendor.id) &&
        vendorSearchByPhone.vendors.some((vendor) => vendor.id === createdVendor.id) &&
        vendorSearchByGst.vendors.some((vendor) => vendor.id === createdVendor.id)
    );

    const crossTenantVendorRead = await getVendorById(companyAdminSession as never, foreignVendor.id);
    pushResult(results, "vendors.tenant_mismatch_blocked", crossTenantVendorRead === null);

    const crossTenantVendorUpdate = await expectThrowMessage(() =>
      updateVendor(companyAdminSession as never, foreignVendor.id, {
        servicePartnerId: companyData.servicePartnerId,
        code: "QAV-F001",
        name: "Cross Tenant Update",
        email: "cross@matrixcrm.local",
        phone: "+919900000099",
        status: VendorStatus.ACTIVE,
        isVerified: true,
        gstNumber: undefined,
        panNumber: undefined,
        address: undefined,
        city: undefined,
        state: undefined,
        country: undefined,
        postalCode: undefined,
        vendorType: undefined,
      })
    );
    pushResult(results, "vendors.tenant_mismatch_update_blocked", crossTenantVendorUpdate.threw);

    const createdRfq = await createRfq(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "QA RFQ One",
      description: "Initial RFQ create",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [
        {
          itemId: companyData.itemId,
          description: "Initial line",
          quantity: 2,
          specs: "Spec A",
          remarks: "Remark A",
        },
      ],
      vendors: [
        {
          vendorId: createdVendor.id,
          status: "INVITED",
          quotedAmount: undefined,
          notes: "Invited",
        },
      ],
    });
    pushResult(results, "rfq.create_rfq", createdRfq.serviceRequestId === companyData.serviceRequestId);
    pushResult(results, "rfq.number_generation_safe", /^RFQ-[A-Z0-9]{1,6}-\d{8}-\d{4}$/.test(createdRfq.rfqNumber));

    const secondGeneratedRfq = await createRfq(companyAdminSession as never, {
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "QA RFQ Number Safety",
      description: "Number generation test",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [
        {
          itemId: companyData.itemId,
          description: "Secondary line",
          quantity: 1,
          specs: "Spec Secondary",
          remarks: "Remark Secondary",
        },
      ],
      vendors: [
        {
          vendorId: createdVendor.id,
          status: "INVITED",
          quotedAmount: undefined,
          notes: "Invited",
        },
      ],
    });
    pushResult(
      results,
      "rfq.number_generation_unique",
      secondGeneratedRfq.rfqNumber !== createdRfq.rfqNumber && /^RFQ-[A-Z0-9]{1,6}-\d{8}-\d{4}$/.test(secondGeneratedRfq.rfqNumber)
    );

    const rfqMissingRequired = rfqUpsertSchema.safeParse({
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "",
      description: "Invalid",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [],
      vendors: [],
    });
    pushResult(results, "rfq.missing_required_rejected", !rfqMissingRequired.success);

    const updatedRfqLine = await updateRfq(companyAdminSession as never, createdRfq.id, {
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "QA RFQ One Updated",
      description: "Updated RFQ",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [
        {
          itemId: companyData.itemId,
          description: "Updated line",
          quantity: 3,
          specs: "Spec B",
          remarks: "Remark B",
        },
      ],
      vendors: [
        {
          vendorId: createdVendor.id,
          status: "QUOTING",
          quotedAmount: undefined,
          notes: "Still quoting",
        },
      ],
    });
    pushResult(results, "rfq.update_item_line", updatedRfqLine.title === "QA RFQ One Updated");

    const addVendorRfq = await updateRfq(companyAdminSession as never, createdRfq.id, {
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "QA RFQ One Updated",
      description: "Updated RFQ",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [
        {
          itemId: companyData.itemId,
          description: "Updated line",
          quantity: 3,
          specs: "Spec B",
          remarks: "Remark B",
        },
      ],
      vendors: [
        {
          vendorId: createdVendor.id,
          status: "QUOTING",
          quotedAmount: undefined,
          notes: "Still quoting",
        },
        {
          vendorId: secondVendor.id,
          status: "INVITED",
          quotedAmount: undefined,
          notes: "New vendor",
        },
      ],
    });
    pushResult(results, "rfq.add_vendor", addVendorRfq.id === createdRfq.id);

    const removeVendorAndLine = await updateRfq(companyAdminSession as never, createdRfq.id, {
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "QA RFQ One Updated",
      description: "Updated RFQ",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [],
      vendors: [
        {
          vendorId: createdVendor.id,
          status: "INVITED",
          quotedAmount: undefined,
          notes: "Only vendor kept",
        },
      ],
    });
    pushResult(results, "rfq.remove_item_line", removeVendorAndLine.id === createdRfq.id);
    pushResult(results, "rfq.remove_vendor", removeVendorAndLine.id === createdRfq.id);

    const restoredRfq = await updateRfq(companyAdminSession as never, createdRfq.id, {
      servicePartnerId: companyData.servicePartnerId,
      clientId: companyData.clientId,
      serviceRequestId: companyData.serviceRequestId,
      title: "QA RFQ One Updated",
      description: "Updated RFQ",
      status: RfqStatus.DRAFT,
      dueDate: undefined,
      lines: [
        {
          itemId: companyData.itemId,
          description: "Restored line",
          quantity: 2,
          specs: "Spec Restored",
          remarks: "Remark Restored",
        },
      ],
      vendors: [
        {
          vendorId: createdVendor.id,
          status: "INVITED",
          quotedAmount: undefined,
          notes: "Restored vendor",
        },
      ],
    });
    pushResult(results, "rfq.add_item_line", restoredRfq.id === createdRfq.id);

    const invalidQuoteAmount = await expectThrowMessage(() =>
      updateRfqVendorQuote(companyAdminSession as never, createdRfq.id, {
        vendorId: createdVendor.id,
        status: "QUOTE_SUBMITTED",
        quotedAmount: undefined,
        notes: "Missing quoted amount",
      })
    );
    pushResult(results, "rfq.vendor_quote_amount_validation", invalidQuoteAmount.threw);

    const quoteCapture = await updateRfqVendorQuote(companyAdminSession as never, createdRfq.id, {
      vendorId: createdVendor.id,
      status: "QUOTE_SUBMITTED",
      quotedAmount: 1234.56,
      notes: "Submitted quote",
    });
    pushResult(results, "rfq.vendor_quote_capture", quoteCapture.status === "QUOTE_SUBMITTED" && Number(quoteCapture.quotedAmount) === 1234.56);

    const sentRfq = await sendRfqToVendors(companyAdminSession as never, createdRfq.id);
    pushResult(results, "rfq.send", sentRfq.status === RfqStatus.PUBLISHED);

    const statusUpdatedRfq = await updateRfqStatus(companyAdminSession as never, createdRfq.id, RfqStatus.QUOTING);
    pushResult(results, "rfq.status_update", statusUpdatedRfq.status === RfqStatus.QUOTING);

    const crossTenantItemBlocked = await expectThrowMessage(() =>
      updateRfq(companyAdminSession as never, createdRfq.id, {
        servicePartnerId: companyData.servicePartnerId,
        clientId: companyData.clientId,
        serviceRequestId: companyData.serviceRequestId,
        title: "Cross item mismatch",
        description: "bad",
        status: RfqStatus.QUOTING,
        dueDate: undefined,
        lines: [
          {
            itemId: foreignData.itemId,
            description: "foreign item",
            quantity: 1,
            specs: undefined,
            remarks: undefined,
          },
        ],
        vendors: [
          {
            vendorId: createdVendor.id,
            status: "INVITED",
            quotedAmount: undefined,
            notes: undefined,
          },
        ],
      })
    );
    pushResult(results, "rfq.tenant_mismatch_item_blocked", crossTenantItemBlocked.threw);

    const crossTenantVendorBlocked = await expectThrowMessage(() =>
      updateRfq(companyAdminSession as never, createdRfq.id, {
        servicePartnerId: companyData.servicePartnerId,
        clientId: companyData.clientId,
        serviceRequestId: companyData.serviceRequestId,
        title: "Cross vendor mismatch",
        description: "bad",
        status: RfqStatus.QUOTING,
        dueDate: undefined,
        lines: [],
        vendors: [
          {
            vendorId: foreignVendor.id,
            status: "INVITED",
            quotedAmount: undefined,
            notes: undefined,
          },
        ],
      })
    );
    pushResult(results, "rfq.tenant_mismatch_vendor_blocked", crossTenantVendorBlocked.threw);

    const crossTenantClientBlocked = await expectThrowMessage(() =>
      createRfq(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        clientId: foreignData.clientId,
        serviceRequestId: companyData.serviceRequestId,
        title: "Cross client mismatch",
        description: "bad",
        status: RfqStatus.DRAFT,
        dueDate: undefined,
        lines: [
          {
            itemId: companyData.itemId,
            description: "line",
            quantity: 1,
            specs: undefined,
            remarks: undefined,
          },
        ],
        vendors: [
          {
            vendorId: createdVendor.id,
            status: "INVITED",
            quotedAmount: undefined,
            notes: undefined,
          },
        ],
      })
    );
    pushResult(results, "rfq.client_tenant_mismatch_blocked", crossTenantClientBlocked.threw);

    const crossTenantServiceRequestBlocked = await expectThrowMessage(() =>
      createRfq(companyAdminSession as never, {
        servicePartnerId: companyData.servicePartnerId,
        clientId: companyData.clientId,
        serviceRequestId: foreignData.serviceRequestId,
        title: "Cross service request mismatch",
        description: "bad",
        status: RfqStatus.DRAFT,
        dueDate: undefined,
        lines: [
          {
            itemId: companyData.itemId,
            description: "line",
            quantity: 1,
            specs: undefined,
            remarks: undefined,
          },
        ],
        vendors: [
          {
            vendorId: createdVendor.id,
            status: "INVITED",
            quotedAmount: undefined,
            notes: undefined,
          },
        ],
      })
    );
    pushResult(results, "rfq.service_request_tenant_mismatch_blocked", crossTenantServiceRequestBlocked.threw);

    const listResult = await listRfqs(companyAdminSession as never, { q: "QA RFQ One", page: 1, pageSize: 20 });
    pushResult(results, "rfq.list_rfqs", listResult.rfqs.length >= 1);

    await softDeleteRfq(companyAdminSession as never, createdRfq.id);
    const listAfterDelete = await listRfqs(companyAdminSession as never, { q: createdRfq.rfqNumber, page: 1, pageSize: 20 });
    pushResult(results, "rfq.list_excludes_deleted_records", listAfterDelete.rfqs.length === 0);

    const deletedVendor = await softDeleteVendor(companyAdminSession as never, secondVendor.id);
    pushResult(results, "vendors.soft_delete_vendor", Boolean(deletedVendor.deletedAt));
    const listAfterVendorDelete = await listVendors(companyAdminSession as never, { q: "QAV-002", page: 1, pageSize: 20 });
    pushResult(results, "vendors.list_excludes_deleted_records", listAfterVendorDelete.vendors.length === 0);

    const noReadCanVendorList = await hasPermission(noReadSession as never, "vendors.read");
    const noReadCanRfqList = await hasPermission(noReadSession as never, "rfq.read");
    const noOpsCanVendorCreate = await hasPermission(noOpsSession as never, "vendors.create");
    const noOpsCanVendorUpdate = await hasPermission(noOpsSession as never, "vendors.update");
    const noOpsCanVendorDelete = await hasPermission(noOpsSession as never, "vendors.delete");
    const noOpsCanRfqCreate = await hasPermission(noOpsSession as never, "rfq.create");
    const noOpsCanRfqUpdate = await hasPermission(noOpsSession as never, "rfq.update");
    const noOpsCanRfqStatusUpdate = await hasPermission(noOpsSession as never, "rfq.status.update");
    const noOpsCanRfqSend = await hasPermission(noOpsSession as never, "rfq.send");
    const noOpsCanVendorQuoteUpdate = await hasPermission(noOpsSession as never, "vendor_quotations.update");
    pushResult(results, "permissions.user_without_vendors_read_cannot_list_vendors", !noReadCanVendorList);
    pushResult(results, "permissions.user_without_rfq_read_cannot_list_rfqs", !noReadCanRfqList);
    pushResult(results, "permissions.user_without_vendors_create_cannot_create_vendor", !noOpsCanVendorCreate);
    pushResult(results, "permissions.user_without_vendors_update_cannot_update_vendor", !noOpsCanVendorUpdate);
    pushResult(results, "permissions.user_without_vendors_delete_cannot_delete_vendor", !noOpsCanVendorDelete);
    pushResult(results, "permissions.user_without_rfq_create_cannot_create_rfq", !noOpsCanRfqCreate);
    pushResult(results, "permissions.user_without_rfq_update_cannot_update_rfq", !noOpsCanRfqUpdate);
    pushResult(results, "permissions.user_without_rfq_status_update_cannot_status_update_rfq", !noOpsCanRfqStatusUpdate);
    pushResult(results, "permissions.user_without_rfq_send_cannot_send_rfq", !noOpsCanRfqSend);
    pushResult(results, "permissions.user_without_vendor_quotation_update_cannot_update_vendor_quote", !noOpsCanVendorQuoteUpdate);

    const vendorActionsSource = readFileSync("features/vendors/actions/vendor.actions.ts", "utf8");
    pushResult(results, "permissions.vendor_actions_guard_create", vendorActionsSource.includes('requirePermission("vendors.create")'));
    pushResult(results, "permissions.vendor_actions_guard_read", readFileSync("app/(dashboard)/vendors/page.tsx", "utf8").includes('requirePermission("vendors.read")'));

    const rfqActionsSource = readFileSync("features/rfqs/actions/rfq.actions.ts", "utf8");
    const rfqPageSource = readFileSync("app/(dashboard)/rfqs/page.tsx", "utf8");
    pushResult(results, "permissions.rfq_actions_guard_create", rfqActionsSource.includes('requirePermission("rfq.create")'));
    pushResult(results, "permissions.rfq_actions_guard_update", rfqActionsSource.includes('requirePermission("rfq.update")'));
    pushResult(
      results,
      "permissions.rfq_actions_guard_status_update",
      rfqActionsSource.includes('requirePermission("rfq.status.update")')
    );
    pushResult(results, "permissions.rfq_actions_guard_send", rfqActionsSource.includes('requirePermission("rfq.send")'));
    pushResult(
      results,
      "permissions.rfq_actions_guard_vendor_quote_update",
      rfqActionsSource.includes('requirePermission("vendor_quotations.update")')
    );
    pushResult(results, "permissions.rfq_actions_guard_read", rfqPageSource.includes('requirePermission("rfq.read")'));

    const packageJson = readFileSync("package.json", "utf8");
    pushResult(
      results,
      "regression.qa_scripts_present",
      packageJson.includes('"qa:access": "tsx scripts/access-governance-qa.ts"') &&
        packageJson.includes('"qa:service-requests": "tsx scripts/service-request-work-items-qa.ts"') &&
        packageJson.includes('"qa:quotations": "tsx scripts/quotation-qa.ts"') &&
        packageJson.includes('"qa:procurement": "tsx scripts/procurement-qa.ts"')
    );

    pushResult(results, "navigation.vendors_page_exists", existsSync("app/(dashboard)/vendors/page.tsx"));
    pushResult(results, "navigation.rfqs_page_exists", existsSync("app/(dashboard)/rfqs/page.tsx"));
    const baselineSource = readFileSync("lib/rbac/baseline.ts", "utf8");
    pushResult(results, "navigation.vendors_nav_no_broken_link", baselineSource.includes('href: "/vendors"'));
    pushResult(results, "navigation.rfqs_nav_no_broken_link", baselineSource.includes('href: "/rfqs"'));
    pushResult(
      results,
      "navigation.po_invoice_vendor_payment_nav_active",
      baselineSource.includes(
        '{ key: "po-list", label: "PO List", href: "/purchase-orders", sortOrder: 29, permissionKey: "purchase_orders.read", isActive: true }'
      ) &&
        baselineSource.includes(
          '{ key: "invoice-list", label: "Invoice List", href: "/invoices", sortOrder: 30, permissionKey: "invoices.read", isActive: true }'
        ) &&
        baselineSource.includes('{ key: "vendor-payments-list", label: "Vendors Payment List", href: "/vendor-payments", sortOrder: 31, permissionKey: "vendor_payments.read", isActive: true }')
    );

    const navWithRead = await getNavigationForSession(companyAdminSession as never);
    const navWithoutRead = await getNavigationForSession(noReadSession as never);
    const navWithReadKeys = new Set(flattenNavKeys(navWithRead as unknown as NavNode[]));
    const navWithoutReadKeys = new Set(flattenNavKeys(navWithoutRead as unknown as NavNode[]));
    pushResult(results, "navigation.vendors_visible_with_permission", navWithReadKeys.has("supplier-management"));
    pushResult(results, "navigation.vendors_hidden_without_permission", !navWithoutReadKeys.has("supplier-management"));
    pushResult(results, "navigation.rfqs_visible_with_permission", navWithReadKeys.has("rfq-list"));
    pushResult(results, "navigation.rfqs_hidden_without_permission", !navWithoutReadKeys.has("rfq-list"));

    const dashboardSource = readFileSync("app/(dashboard)/page.tsx", "utf8");
    pushResult(results, "dashboard.vendor_kpi_permission_gated", dashboardSource.includes('can("vendors.read") ? prisma.vendor.count'));
    pushResult(results, "dashboard.rfq_kpi_permission_gated", dashboardSource.includes('can("rfq.read") ? prisma.rfq.count'));
    pushResult(results, "dashboard.add_vendor_action_permission_gated", dashboardSource.includes('title: "Add Vendor"') && dashboardSource.includes('permission: "vendors.create"'));
    pushResult(results, "dashboard.new_rfq_action_permission_gated", dashboardSource.includes('title: "New RFQ"') && dashboardSource.includes('permission: "rfq.create"'));
    pushResult(
      results,
      "dashboard.tenant_scoped_counts_non_super_admin",
      dashboardSource.includes('prisma.vendor.count({ where: scopeByTenant(session, { deletedAt: null }) })') &&
        dashboardSource.includes('prisma.rfq.count({ where: scopeByTenant(session, { deletedAt: null }) })')
    );
  } finally {
    await cleanupQaRecords({ serviceRequestIds: qaServiceRequestIds });
    await cleanupQaVendors([...qaVendorCodes, "QAV-001", "QAV-002", "QAV-F001"]);
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
