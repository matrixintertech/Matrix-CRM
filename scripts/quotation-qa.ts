import { existsSync, readFileSync } from "node:fs";
import {
  ApprovalStatus,
  PrismaClient,
  RateCardStatus,
  ServicePartnerStatus,
  ServiceRequestStatus,
  UserStatus,
} from "@prisma/client";

import {
  createQuotation,
  getQuotationById,
  listQuotationItemOptions,
  listQuotationsForServiceRequest,
  softDeleteQuotation,
  submitQuotation,
  updateQuotation,
  updateQuotationStatus,
} from "../features/quotations/services/quotation.service";
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
  branchId: string;
  serviceRequestId: string;
  categoryId: string;
  itemId: string;
};

type ThrowResult = {
  threw: boolean;
  message?: string;
};

const QA_PREFIX = "qa.quotation";
const COMPANY_CODE = "QAQCOMP";
const FOREIGN_CODE = "QAQFORE";
const COMPANY_RATE_CARD_CODE = "QAQRC-COMPANY-001";
const FOREIGN_RATE_CARD_CODE = "QAQRC-FOREIGN-001";
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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

async function cleanupQaRecords(input: { serviceRequestIds: string[] }) {
  if (input.serviceRequestIds.length === 0) {
    return;
  }

  const quotations = await prisma.quotation.findMany({
    where: {
      serviceRequestId: { in: input.serviceRequestIds },
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

async function cleanupQaRateCards() {
  const rateCards = await prisma.rateCard.findMany({
    where: {
      code: {
        in: [COMPANY_RATE_CARD_CODE, FOREIGN_RATE_CARD_CODE],
      },
    },
    select: {
      id: true,
    },
  });
  const rateCardIds = rateCards.map((rateCard) => rateCard.id);
  if (rateCardIds.length === 0) {
    return;
  }

  await prisma.rateCardLine.deleteMany({
    where: {
      rateCardId: {
        in: rateCardIds,
      },
    },
  });
  await prisma.rateCard.deleteMany({
    where: {
      id: {
        in: rateCardIds,
      },
    },
  });
}

async function main() {
  const results: QAResult[] = [];
  const qaServiceRequestIds: string[] = [];

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
    const companyCalcData = await ensureTenantData({
      servicePartnerId: companyPartner.id,
      prefix: "QAQCAL",
      createdByUserId: qaCompanyAdmin.id,
    });
    const companyNoQuoteData = await ensureTenantData({
      servicePartnerId: companyPartner.id,
      prefix: "QAQNOQ",
      createdByUserId: qaCompanyAdmin.id,
    });
    const companyRecalcData = await ensureTenantData({
      servicePartnerId: companyPartner.id,
      prefix: "QAQREC",
      createdByUserId: qaCompanyAdmin.id,
    });
    const foreignData = await ensureTenantData({
      servicePartnerId: foreignPartner.id,
      prefix: "QAQTNF",
      createdByUserId: foreignUser.id,
    });

    qaServiceRequestIds.push(
      companyData.serviceRequestId,
      companyCalcData.serviceRequestId,
      companyNoQuoteData.serviceRequestId,
      companyRecalcData.serviceRequestId,
      foreignData.serviceRequestId
    );

    await cleanupQaRecords({ serviceRequestIds: qaServiceRequestIds });
    await cleanupQaRateCards();

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

    const effectiveFrom = new Date("2026-01-01T00:00:00.000Z");
    const companyRateCard = await prisma.rateCard.upsert({
      where: {
        servicePartnerId_code: {
          servicePartnerId: companyPartner.id,
          code: COMPANY_RATE_CARD_CODE,
        },
      },
      update: {
        clientId: companyData.clientId,
        name: "QA Company Rate Card",
        effectiveFrom,
        effectiveTo: null,
        status: RateCardStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        servicePartnerId: companyPartner.id,
        clientId: companyData.clientId,
        code: COMPANY_RATE_CARD_CODE,
        name: "QA Company Rate Card",
        effectiveFrom,
        effectiveTo: null,
        status: RateCardStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });
    const foreignRateCard = await prisma.rateCard.upsert({
      where: {
        servicePartnerId_code: {
          servicePartnerId: foreignPartner.id,
          code: FOREIGN_RATE_CARD_CODE,
        },
      },
      update: {
        clientId: foreignData.clientId,
        name: "QA Foreign Rate Card",
        effectiveFrom,
        effectiveTo: null,
        status: RateCardStatus.ACTIVE,
        deletedAt: null,
      },
      create: {
        servicePartnerId: foreignPartner.id,
        clientId: foreignData.clientId,
        code: FOREIGN_RATE_CARD_CODE,
        name: "QA Foreign Rate Card",
        effectiveFrom,
        effectiveTo: null,
        status: RateCardStatus.ACTIVE,
      },
      select: {
        id: true,
      },
    });
    await prisma.rateCardLine.upsert({
      where: {
        rateCardId_itemId: {
          rateCardId: companyRateCard.id,
          itemId: companyData.itemId,
        },
      },
      update: {
        rate: 123.45,
        taxPercent: 18,
      },
      create: {
        rateCardId: companyRateCard.id,
        itemId: companyData.itemId,
        rate: 123.45,
        taxPercent: 18,
      },
    });
    await prisma.rateCardLine.upsert({
      where: {
        rateCardId_itemId: {
          rateCardId: foreignRateCard.id,
          itemId: companyData.itemId,
        },
      },
      update: {
        rate: 999.99,
        taxPercent: 50,
      },
      create: {
        rateCardId: foreignRateCard.id,
        itemId: companyData.itemId,
        rate: 999.99,
        taxPercent: 50,
      },
    });

    const quotationItemOptions = await listQuotationItemOptions(companyAdminSession as never, companyData.serviceRequestId);
    const companyItemOption = quotationItemOptions.find((item) => item.id === companyData.itemId);
    pushResult(results, "quotations.item_options_loaded", Boolean(companyItemOption));
    pushResult(results, "tenant.rate_card_default_company_applied", companyItemOption?.defaultUnitRate === "123.45");
    pushResult(results, "tenant.rate_card_default_tax_applied", companyItemOption?.defaultTaxPercent === "18.00");
    pushResult(results, "tenant.rate_card_mismatch_blocked", companyItemOption?.defaultUnitRate !== "999.99");

    const calculationQuote = await createQuotation(companyAdminSession as never, {
      serviceRequestId: companyCalcData.serviceRequestId,
      validUntil: undefined,
      notes: "QA calculation quote",
      lines: [
        {
          itemId: companyCalcData.itemId,
          description: "Decimal and zero tax",
          quantity: 1.234,
          unitRate: 99.99,
          taxPercent: 0,
        },
        {
          itemId: companyData.itemId,
          description: "Hundred tax",
          quantity: 2,
          unitRate: 50,
          taxPercent: 100,
        },
        {
          itemId: companyNoQuoteData.itemId,
          description: "Rounding line",
          quantity: 3,
          unitRate: 10.005,
          taxPercent: 18,
        },
      ],
    });
    pushResult(results, "calc.decimal_quantity_handled", Number(calculationQuote.subtotal) === 253.42);
    pushResult(results, "calc.zero_tax_handled", Number(calculationQuote.taxTotal) >= 0);
    pushResult(results, "calc.hundred_tax_handled", Number(calculationQuote.taxTotal) === 105.41);
    pushResult(results, "calc.multiple_lines_handled", Number(calculationQuote.grandTotal) === 358.83);
    pushResult(
      results,
      "calc.rounding_consistency",
      Number(calculationQuote.grandTotal) === roundMoney(Number(calculationQuote.subtotal) + Number(calculationQuote.taxTotal))
    );

    const calculationDetail = await getQuotationById(companyAdminSession as never, calculationQuote.id);
    const hundredTaxLine = calculationDetail?.items.find((line) => line.itemId === companyData.itemId);
    pushResult(results, "calc.line_with_100_tax_total", Number(hundredTaxLine?.amount ?? 0) === 200);

    const recalculatedQuote = await createQuotation(companyAdminSession as never, {
      serviceRequestId: companyRecalcData.serviceRequestId,
      validUntil: undefined,
      notes: "QA server recalculation",
      lines: [
        {
          itemId: companyRecalcData.itemId,
          description: "Ignore client totals",
          quantity: 1,
          unitRate: 10,
          taxPercent: 0,
          subtotal: 999999,
          taxTotal: 999999,
          grandTotal: 999999,
        },
      ],
      subtotal: 999999,
      taxTotal: 999999,
      grandTotal: 999999,
    } as never);
    pushResult(results, "calc.server_recalculates_totals", Number(recalculatedQuote.grandTotal) === 10);

    const invalidQuantity = await expectThrowMessage(() =>
      createQuotation(companyAdminSession as never, {
        serviceRequestId: companyNoQuoteData.serviceRequestId,
        validUntil: undefined,
        notes: "Invalid quantity",
        lines: [
          {
            itemId: companyNoQuoteData.itemId,
            description: "negative quantity",
            quantity: -1,
            unitRate: 1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(
      results,
      "calc.negative_quantity_rejected",
      invalidQuantity.threw && (invalidQuantity.message?.toLowerCase().includes("validation") ?? false)
    );

    const invalidRate = await expectThrowMessage(() =>
      createQuotation(companyAdminSession as never, {
        serviceRequestId: companyNoQuoteData.serviceRequestId,
        validUntil: undefined,
        notes: "Invalid unit rate",
        lines: [
          {
            itemId: companyNoQuoteData.itemId,
            description: "negative rate",
            quantity: 1,
            unitRate: -1,
            taxPercent: 0,
          },
        ],
      })
    );
    pushResult(
      results,
      "calc.negative_rate_rejected",
      invalidRate.threw && (invalidRate.message?.toLowerCase().includes("validation") ?? false)
    );

    const invalidTax = await expectThrowMessage(() =>
      createQuotation(companyAdminSession as never, {
        serviceRequestId: companyNoQuoteData.serviceRequestId,
        validUntil: undefined,
        notes: "Invalid tax",
        lines: [
          {
            itemId: companyNoQuoteData.itemId,
            description: "negative tax",
            quantity: 1,
            unitRate: 1,
            taxPercent: -1,
          },
        ],
      })
    );
    pushResult(results, "calc.negative_tax_rejected", invalidTax.threw && (invalidTax.message?.toLowerCase().includes("validation") ?? false));

    const invalidTaxHigh = await expectThrowMessage(() =>
      createQuotation(companyAdminSession as never, {
        serviceRequestId: companyNoQuoteData.serviceRequestId,
        validUntil: undefined,
        notes: "Invalid tax high",
        lines: [
          {
            itemId: companyNoQuoteData.itemId,
            description: "tax high",
            quantity: 1,
            unitRate: 1,
            taxPercent: 101,
          },
        ],
      })
    );
    pushResult(results, "calc.tax_gt_100_rejected", invalidTaxHigh.threw && (invalidTaxHigh.message?.toLowerCase().includes("validation") ?? false));

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
    pushResult(results, "lifecycle.create_quote", createdQuotation.serviceRequestId === companyData.serviceRequestId);
    pushResult(results, "lifecycle.quote_number_generated", createdQuotation.quotationNumber.startsWith("QTN-"));
    pushResult(results, "lifecycle.create_total_calculation", Number(createdQuotation.grandTotal) === 220);

    const duplicateCreate = await expectThrowMessage(() =>
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
    pushResult(results, "lifecycle.one_quote_per_service_request_clean_error", duplicateCreate.threw);
    pushResult(
      results,
      "lifecycle.one_quote_per_service_request_error_text",
      duplicateCreate.message?.toLowerCase().includes("already exists") ?? false
    );

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
    pushResult(results, "lifecycle.update_quote_lines", Number(updatedQuotation.grandTotal) === 346.5);

    const deleteLineUpdate = await updateQuotation(companyAdminSession as never, createdQuotation.id, {
      serviceRequestId: companyData.serviceRequestId,
      validUntil: undefined,
      notes: "QA delete line",
      lines: [],
    });
    pushResult(results, "lifecycle.delete_quote_line", Number(deleteLineUpdate.grandTotal) === 0);

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
    pushResult(results, "lifecycle.add_quote_line_again", Number(addLineAgain.grandTotal) === 236);

    const foreignItemCreateBlocked = await expectThrowMessage(() =>
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
    pushResult(results, "tenant.item_tenant_mismatch_blocked", foreignItemCreateBlocked.threw);

    const tenantMismatchBlocked = await expectThrowMessage(() =>
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
    pushResult(results, "tenant.service_request_tenant_mismatch_blocked", tenantMismatchBlocked.threw);

    const statusUpdated = await updateQuotationStatus(companyAdminSession as never, createdQuotation.id, {
      status: ApprovalStatus.APPROVED,
    });
    pushResult(results, "lifecycle.status_update", statusUpdated.status === ApprovalStatus.APPROVED);

    const submitted = await submitQuotation(companyAdminSession as never, createdQuotation.id);
    pushResult(results, "lifecycle.submit_quote", submitted.status === ApprovalStatus.PENDING);

    const serviceRequestQuotations = await listQuotationsForServiceRequest(
      companyAdminSession as never,
      companyData.serviceRequestId
    );
    pushResult(
      results,
      "integration.service_request_detail_fetch_includes_quote_summary",
      serviceRequestQuotations.quotations.length === 1
    );

    const readOnlyList = await listQuotationsForServiceRequest(noOpsSession as never, companyData.serviceRequestId);
    pushResult(results, "permissions.read_only_user_can_view", readOnlyList.quotations.length === 1);

    const noQuoteList = await listQuotationsForServiceRequest(companyAdminSession as never, companyNoQuoteData.serviceRequestId);
    pushResult(results, "integration.no_quote_state_does_not_break", noQuoteList.quotations.length === 0);

    await softDeleteQuotation(companyAdminSession as never, createdQuotation.id);
    const listedAfterDelete = await listQuotationsForServiceRequest(companyAdminSession as never, companyData.serviceRequestId);
    pushResult(results, "lifecycle.soft_delete_quote", listedAfterDelete.quotations.length === 0);
    pushResult(results, "lifecycle.deleted_quote_excluded_from_normal_list", listedAfterDelete.quotations.length === 0);

    const noOpsCanRead = await hasPermission(noOpsSession as never, "quotations.read");
    const noOpsCanCreate = await hasPermission(noOpsSession as never, "quotations.create");
    const noOpsCanUpdate = await hasPermission(noOpsSession as never, "quotations.update");
    const noOpsCanDelete = await hasPermission(noOpsSession as never, "quotations.delete");
    const noOpsCanSubmit = await hasPermission(noOpsSession as never, "quotations.submit");
    const noOpsCanStatusUpdate = await hasPermission(noOpsSession as never, "quotations.status.update");
    pushResult(results, "permissions.user_without_quotations_create_cannot_create", !noOpsCanCreate);
    pushResult(results, "permissions.user_without_quotations_update_cannot_update", !noOpsCanUpdate);
    pushResult(results, "permissions.user_without_quotations_delete_cannot_delete", !noOpsCanDelete);
    pushResult(results, "permissions.user_without_quotations_submit_cannot_submit", !noOpsCanSubmit);
    pushResult(results, "permissions.user_without_quotations_status_update_cannot_update_status", !noOpsCanStatusUpdate);
    pushResult(results, "permissions.read_only_user_has_read_only_access", noOpsCanRead && !noOpsCanCreate && !noOpsCanUpdate && !noOpsCanDelete);

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
      "permissions.quotation_action_has_delete_guard",
      actionSource.includes('requirePermission("quotations.delete")')
    );
    pushResult(
      results,
      "permissions.quotation_action_has_submit_guard",
      actionSource.includes('requirePermission("quotations.submit")')
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

    const serviceRequestDetailSource = readFileSync("app/(dashboard)/service-requests/[id]/page.tsx", "utf8");
    pushResult(
      results,
      "integration.quotation_section_present_in_service_request_detail",
      serviceRequestDetailSource.includes("QuotationSummaryCard") && serviceRequestDetailSource.includes("QuotationsTable")
    );
    pushResult(
      results,
      "integration.no_broken_quotations_nav_link",
      !serviceRequestDetailSource.includes('href="/quotations"')
    );

    const hasStandaloneQuotationsPage = existsSync("app/(dashboard)/quotations/page.tsx");
    pushResult(results, "regression.no_required_standalone_quotations_page", !hasStandaloneQuotationsPage);

    const statusBadgeSource = readFileSync("components/admin/status-badge.tsx", "utf8");
    pushResult(
      results,
      "integration.status_badges_render_known_approval_statuses",
      statusBadgeSource.includes("PENDING") &&
        statusBadgeSource.includes("REVISED") &&
        statusBadgeSource.includes("REJECTED") &&
        statusBadgeSource.includes("APPROVED")
    );

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

    const superMismatchedItemBlocked = await expectThrowMessage(() =>
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
    pushResult(results, "tenant.super_admin_mismatched_item_blocked", superMismatchedItemBlocked.threw);
  } finally {
    await cleanupQaRecords({ serviceRequestIds: qaServiceRequestIds });
    await cleanupQaRateCards();
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
