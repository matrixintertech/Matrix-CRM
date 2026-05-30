import { existsSync, readFileSync } from "node:fs";
import {
  ApprovalStatus,
  PrismaClient,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
} from "@prisma/client";

import {
  createQuotation,
  listQuotationItemOptions,
  listQuotationsForServiceRequest,
  softDeleteQuotation,
  submitQuotation,
  updateQuotation,
  updateQuotationStatus,
} from "../features/quotations/services/quotation.service";
import { getUserPermissions, hasPermission } from "../lib/auth/permissions";
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
  branchId: string;
  serviceRequestId: string;
  categoryId: string;
  itemId: string;
};

const QA_PREFIX = "qa.quotation";
const COMPANY_CODE = "QAQCOMP";
const FOREIGN_CODE = "QAQFORE";
const REQUIRED_PERMISSION_KEYS = [
  "quotations.read",
  "quotations.create",
  "quotations.update",
  "quotations.delete",
  "quotations.status.update",
  "quotations.submit",
  "quotations.approve",
] as const;

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

async function expectThrow(fn: () => Promise<unknown>) {
  try {
    await fn();
    return false;
  } catch {
    return true;
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
      description: "QA quotation checks",
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
      description: "QA quotation checks",
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

async function cleanupQaRecords(data: {
  companyServiceRequestId?: string;
  foreignServiceRequestId?: string;
}) {
  const serviceRequestIds = [data.companyServiceRequestId, data.foreignServiceRequestId].filter(
    (value): value is string => Boolean(value)
  );
  if (serviceRequestIds.length === 0) {
    return;
  }

  const quotations = await prisma.quotation.findMany({
    where: {
      serviceRequestId: { in: serviceRequestIds },
    },
    select: {
      id: true,
    },
  });
  const quotationIds = quotations.map((quotation) => quotation.id);
  if (quotationIds.length > 0) {
    await prisma.quotationItem.deleteMany({
      where: {
        quotationId: {
          in: quotationIds,
        },
      },
    });
    await prisma.quotation.deleteMany({
      where: {
        id: {
          in: quotationIds,
        },
      },
    });
  }
}

async function main() {
  const results: QAResult[] = [];
  let companyServiceRequestId: string | undefined;
  let foreignServiceRequestId: string | undefined;

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

    const companyPartner = await ensureServicePartner(COMPANY_CODE, "QA Quotation Company");
    const foreignPartner = await ensureServicePartner(FOREIGN_CODE, "QA Quotation Foreign");

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
      name: "QA Quotation Company Admin",
      phone: "+919931000001",
      status: UserStatus.ACTIVE,
    });
    const qaNoOpsUser = await ensureQaUser({
      servicePartnerId: companyPartner.id,
      roleId: managerRole.id,
      email: `${QA_PREFIX}.noops@matrixcrm.local`,
      name: "QA Quotation No Ops",
      phone: "+919931000002",
      status: UserStatus.ACTIVE,
    });
    const foreignUser = await ensureQaUser({
      servicePartnerId: foreignPartner.id,
      roleId: foreignManagerRole.id,
      email: `${QA_PREFIX}.foreign@matrixcrm.local`,
      name: "QA Quotation Foreign User",
      phone: "+919931000003",
      status: UserStatus.ACTIVE,
    });

    const companyData = await ensureTenantData({
      servicePartnerId: companyPartner.id,
      prefix: "QAQTN",
      createdByUserId: qaCompanyAdmin.id,
    });
    const foreignData = await ensureTenantData({
      servicePartnerId: foreignPartner.id,
      prefix: "QAQTNF",
      createdByUserId: foreignUser.id,
    });
    companyServiceRequestId = companyData.serviceRequestId;
    foreignServiceRequestId = foreignData.serviceRequestId;

    await cleanupQaRecords({
      companyServiceRequestId,
      foreignServiceRequestId,
    });

    await replaceDirectPermissions({
      userId: qaCompanyAdmin.id,
      servicePartnerId: companyPartner.id,
      assignedByUserId: superAdmin.id,
      permissionKeys: [
        "service_requests.read",
        "quotations.read",
        "quotations.create",
        "quotations.update",
        "quotations.delete",
        "quotations.status.update",
        "quotations.submit",
        "quotations.approve",
      ],
    });
    await replaceDirectPermissions({
      userId: qaNoOpsUser.id,
      servicePartnerId: companyPartner.id,
      assignedByUserId: superAdmin.id,
      permissionKeys: ["service_requests.read", "quotations.read"],
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

    const quotationItemOptions = await listQuotationItemOptions(companyAdminSession as never, companyData.serviceRequestId);
    pushResult(results, "quotations.item_options_loaded", quotationItemOptions.some((item) => item.id === companyData.itemId));

    const createdQuotation = await createQuotation(companyAdminSession as never, {
      serviceRequestId: companyData.serviceRequestId,
      validUntil: undefined,
      notes: "QA quotation create",
      lines: [
        {
          itemId: companyData.itemId,
          description: "Initial line",
          quantity: 2,
          unitRate: 100,
          taxPercent: 10,
        },
      ],
    });
    pushResult(results, "quotations.create_under_service_request", createdQuotation.serviceRequestId === companyData.serviceRequestId);
    pushResult(results, "quotations.quote_number_generated", createdQuotation.quotationNumber.startsWith("QTN-"));
    pushResult(results, "quotations.total_calculation_on_create", Number(createdQuotation.grandTotal) === 220);

    const duplicateCreateBlocked = await expectThrow(() =>
      createQuotation(companyAdminSession as never, {
        serviceRequestId: companyData.serviceRequestId,
        validUntil: undefined,
        notes: "Duplicate",
        lines: [
          {
            itemId: companyData.itemId,
            description: "Duplicate line",
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "quotations.duplicate_create_blocked", duplicateCreateBlocked);

    const updatedQuotation = await updateQuotation(companyAdminSession as never, createdQuotation.id, {
      serviceRequestId: companyData.serviceRequestId,
      validUntil: undefined,
      notes: "QA update",
      lines: [
        {
          itemId: companyData.itemId,
          description: "Updated line",
          quantity: 3,
          unitRate: 110,
          taxPercent: 5,
        },
      ],
    });
    pushResult(results, "quotations.update_line_works", Number(updatedQuotation.grandTotal) === 346.5);

    const deleteLineUpdate = await updateQuotation(companyAdminSession as never, createdQuotation.id, {
      serviceRequestId: companyData.serviceRequestId,
      validUntil: undefined,
      notes: "QA delete line",
      lines: [],
    });
    pushResult(results, "quotations.delete_line_works", Number(deleteLineUpdate.grandTotal) === 0);

    const addLineAgain = await updateQuotation(companyAdminSession as never, createdQuotation.id, {
      serviceRequestId: companyData.serviceRequestId,
      validUntil: undefined,
      notes: "QA add line again",
      lines: [
        {
          itemId: companyData.itemId,
          description: "Re-added line",
          quantity: 4,
          unitRate: 50,
          taxPercent: 18,
        },
      ],
    });
    pushResult(results, "quotations.add_line_works", Number(addLineAgain.grandTotal) === 236);

    const foreignItemCreateBlocked = await expectThrow(() =>
      updateQuotation(companyAdminSession as never, createdQuotation.id, {
        serviceRequestId: companyData.serviceRequestId,
        validUntil: undefined,
        notes: "cross tenant item",
        lines: [
          {
            itemId: foreignData.itemId,
            description: "invalid cross tenant item",
            quantity: 1,
            unitRate: 10,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "quotations.cross_tenant_item_blocked", foreignItemCreateBlocked);

    const tenantMismatchBlocked = await expectThrow(() =>
      createQuotation(companyAdminSession as never, {
        serviceRequestId: foreignData.serviceRequestId,
        validUntil: undefined,
        notes: "cross tenant service request",
        lines: [
          {
            itemId: foreignData.itemId,
            description: "invalid",
            quantity: 1,
            unitRate: 10,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "quotations.tenant_mismatch_service_request_blocked", tenantMismatchBlocked);

    const statusUpdated = await updateQuotationStatus(companyAdminSession as never, createdQuotation.id, {
      status: ApprovalStatus.APPROVED,
    });
    pushResult(results, "quotations.status_update_works", statusUpdated.status === ApprovalStatus.APPROVED);

    const submitted = await submitQuotation(companyAdminSession as never, createdQuotation.id);
    pushResult(results, "quotations.submit_works", submitted.status === ApprovalStatus.PENDING);

    const serviceRequestQuotations = await listQuotationsForServiceRequest(
      companyAdminSession as never,
      companyData.serviceRequestId
    );
    pushResult(
      results,
      "quotations.service_request_detail_fetch_includes_quotations",
      serviceRequestQuotations.quotations.length === 1
    );

    await softDeleteQuotation(companyAdminSession as never, createdQuotation.id);
    const listedAfterDelete = await listQuotationsForServiceRequest(companyAdminSession as never, companyData.serviceRequestId);
    pushResult(results, "quotations.soft_delete_excluded_from_list", listedAfterDelete.quotations.length === 0);

    const noOpsCanCreate = await hasPermission(noOpsSession as never, "quotations.create");
    const noOpsCanUpdate = await hasPermission(noOpsSession as never, "quotations.update");
    const noOpsCanStatusUpdate = await hasPermission(noOpsSession as never, "quotations.status.update");
    pushResult(results, "permissions.user_without_quotations_create_cannot_create", !noOpsCanCreate);
    pushResult(results, "permissions.user_without_quotations_update_cannot_update", !noOpsCanUpdate);
    pushResult(results, "permissions.user_without_quotations_status_update_cannot_update_status", !noOpsCanStatusUpdate);

    const actionSource = readFileSync("features/quotations/actions/quotation.actions.ts", "utf8");
    pushResult(
      results,
      "permissions.quotation_action_has_create_guard",
      actionSource.includes('requirePermission("quotations.create")')
    );
    pushResult(
      results,
      "permissions.quotation_action_has_update_guard",
      actionSource.includes('requirePermission("quotations.update")')
    );
    pushResult(
      results,
      "permissions.quotation_action_has_status_guard",
      actionSource.includes('requirePermission("quotations.status.update")')
    );

    const packageJson = readFileSync("package.json", "utf8");
    pushResult(
      results,
      "regression.qa_access_script_present",
      packageJson.includes('"qa:access": "tsx scripts/access-governance-qa.ts"')
    );
    pushResult(
      results,
      "regression.qa_service_requests_script_present",
      packageJson.includes('"qa:service-requests": "tsx scripts/service-request-work-items-qa.ts"')
    );

    const hasStandaloneQuotationsPage = existsSync("app/(dashboard)/quotations/page.tsx");
    pushResult(results, "regression.no_required_standalone_quotations_page", !hasStandaloneQuotationsPage);

    const superForeignQuote = await createQuotation(superSession as never, {
      serviceRequestId: foreignData.serviceRequestId,
      validUntil: undefined,
      notes: "Super admin create foreign quotation",
      lines: [
        {
          itemId: foreignData.itemId,
          description: "foreign line",
          quantity: 1,
          unitRate: 100,
          taxPercent: 0,
        },
      ],
    });
    pushResult(results, "tenant.super_admin_platform_wide_quote_operation", superForeignQuote.serviceRequestId === foreignData.serviceRequestId);

    const superMismatchedItemBlocked = await expectThrow(() =>
      updateQuotation(superSession as never, superForeignQuote.id, {
        serviceRequestId: foreignData.serviceRequestId,
        validUntil: undefined,
        notes: "super invalid item",
        lines: [
          {
            itemId: companyData.itemId,
            description: "mismatch",
            quantity: 1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(results, "tenant.super_admin_mismatched_item_blocked", superMismatchedItemBlocked);
  } finally {
    await cleanupQaRecords({
      companyServiceRequestId,
      foreignServiceRequestId,
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
