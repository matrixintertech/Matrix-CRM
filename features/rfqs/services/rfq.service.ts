import { Prisma, RfqStatus, RfqVendorStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { RfqLineInput, RfqUpsertInput, RfqVendorInput } from "@/features/rfqs/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListRfqsInput = {
  q?: string;
  status?: RfqStatus;
  statusGroup?: RfqStatusGroup;
  vendorId?: string;
  categoryId?: string;
  servicePartnerId?: string;
  dateRange?: RfqDateRange;
  page?: number;
  pageSize?: number;
};

export type RfqStatusGroup = "open" | "in_progress" | "completed" | "cancelled";
export type RfqDateRange = "today" | "this_week" | "this_month" | "overdue";

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function toYyyyMmDd(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

const rfqStatusTransitionMap: Record<RfqStatus, readonly RfqStatus[]> = {
  [RfqStatus.DRAFT]: [RfqStatus.DRAFT, RfqStatus.PUBLISHED, RfqStatus.QUOTING, RfqStatus.CANCELLED],
  [RfqStatus.PUBLISHED]: [RfqStatus.PUBLISHED, RfqStatus.QUOTING, RfqStatus.CLOSED, RfqStatus.CANCELLED],
  [RfqStatus.QUOTING]: [RfqStatus.QUOTING, RfqStatus.CLOSED, RfqStatus.CANCELLED],
  [RfqStatus.CLOSED]: [RfqStatus.CLOSED],
  [RfqStatus.CANCELLED]: [RfqStatus.CANCELLED],
};

const rfqVendorStatusTransitionMap: Record<RfqVendorStatus, readonly RfqVendorStatus[]> = {
  [RfqVendorStatus.INVITED]: [
    RfqVendorStatus.INVITED,
    RfqVendorStatus.QUOTING,
    RfqVendorStatus.QUOTE_SUBMITTED,
    RfqVendorStatus.REJECTED,
    RfqVendorStatus.CANCELLED,
  ],
  [RfqVendorStatus.QUOTING]: [
    RfqVendorStatus.QUOTING,
    RfqVendorStatus.QUOTE_SUBMITTED,
    RfqVendorStatus.SELECTED,
    RfqVendorStatus.REJECTED,
    RfqVendorStatus.CANCELLED,
  ],
  [RfqVendorStatus.QUOTE_SUBMITTED]: [
    RfqVendorStatus.QUOTE_SUBMITTED,
    RfqVendorStatus.SELECTED,
    RfqVendorStatus.REJECTED,
    RfqVendorStatus.CANCELLED,
  ],
  [RfqVendorStatus.SELECTED]: [RfqVendorStatus.SELECTED, RfqVendorStatus.CANCELLED],
  [RfqVendorStatus.REJECTED]: [RfqVendorStatus.REJECTED],
  [RfqVendorStatus.CANCELLED]: [RfqVendorStatus.CANCELLED],
};

function assertRfqStatusTransition(currentStatus: RfqStatus, nextStatus: RfqStatus) {
  const allowedStatuses = rfqStatusTransitionMap[currentStatus] ?? [currentStatus];
  if (!allowedStatuses.includes(nextStatus)) {
    throw new Error(`RFQ status transition is not allowed: ${currentStatus} -> ${nextStatus}.`);
  }
}

function assertRfqVendorStatusTransition(currentStatus: RfqVendorStatus, nextStatus: RfqVendorStatus) {
  const allowedStatuses = rfqVendorStatusTransitionMap[currentStatus] ?? [currentStatus];
  if (!allowedStatuses.includes(nextStatus)) {
    throw new Error(`RFQ vendor status transition is not allowed: ${currentStatus} -> ${nextStatus}.`);
  }
}

export function getRfqScopeWhere(session: Session): Prisma.RfqWhereInput {
  return scopeByTenant(session, {});
}

function getStatusesForGroup(group: RfqStatusGroup) {
  if (group === "open") {
    return [RfqStatus.DRAFT, RfqStatus.PUBLISHED];
  }
  if (group === "in_progress") {
    return [RfqStatus.QUOTING];
  }
  if (group === "completed") {
    return [RfqStatus.CLOSED];
  }
  return [RfqStatus.CANCELLED];
}

function buildRfqWhere(
  session: Session,
  input: Pick<ListRfqsInput, "q" | "status" | "statusGroup" | "vendorId" | "categoryId" | "servicePartnerId" | "dateRange">
): Prisma.RfqWhereInput {
  const where: Prisma.RfqWhereInput = {
    ...getRfqScopeWhere(session),
    deletedAt: null,
  };

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (input.status) {
    where.status = input.status;
  } else if (input.statusGroup) {
    where.status = {
      in: getStatusesForGroup(input.statusGroup),
    };
  }

  if (input.vendorId?.trim()) {
    where.vendorQuotes = {
      some: {
        vendorId: input.vendorId,
      },
    };
  }

  if (input.categoryId?.trim()) {
    where.items = {
      some: {
        OR: [
          { categoryId: input.categoryId.trim() },
          {
            item: {
              categoryId: input.categoryId.trim(),
            },
          },
        ],
      },
    };
  }

  if (input.dateRange) {
    const now = new Date();
    const startToday = new Date(now);
    startToday.setHours(0, 0, 0, 0);
    const endToday = new Date(startToday);
    endToday.setHours(23, 59, 59, 999);

    if (input.dateRange === "today") {
      where.dueDate = {
        gte: startToday,
        lte: endToday,
      };
    } else if (input.dateRange === "this_week") {
      const endWeek = new Date(startToday);
      endWeek.setDate(endWeek.getDate() + 7);
      endWeek.setHours(23, 59, 59, 999);
      where.dueDate = {
        gte: startToday,
        lte: endWeek,
      };
    } else if (input.dateRange === "this_month") {
      const endMonth = new Date(startToday.getFullYear(), startToday.getMonth() + 1, 0, 23, 59, 59, 999);
      where.dueDate = {
        gte: startToday,
        lte: endMonth,
      };
    } else if (input.dateRange === "overdue") {
      where.dueDate = {
        lt: now,
      };
      where.status = {
        notIn: [RfqStatus.CLOSED, RfqStatus.CANCELLED],
      };
    }
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { rfqNumber: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      {
        servicePartner: {
          name: { contains: q, mode: "insensitive" },
        },
      },
      {
        items: {
          some: {
            OR: [
              {
                category: {
                  name: { contains: q, mode: "insensitive" },
                },
              },
              {
                item: {
                  name: { contains: q, mode: "insensitive" },
                },
              },
            ],
          },
        },
      },
      {
        vendorQuotes: {
          some: {
            vendor: {
              name: { contains: q, mode: "insensitive" },
            },
          },
        },
      },
    ];
  }

  return where;
}

export async function listRfqs(session: Session, input: ListRfqsInput) {
  const pagination = getPagination(input);
  const where = buildRfqWhere(session, input);

  const [rfqs, total] = await Promise.all([
    prisma.rfq.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
      include: {
        servicePartner: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        serviceRequest: {
          select: {
            id: true,
            serviceNumber: true,
            title: true,
          },
        },
        items: {
          take: 3,
          orderBy: [{ id: "asc" }],
          select: {
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            item: {
              select: {
                id: true,
                name: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            items: true,
            vendorQuotes: true,
          },
        },
      },
    }),
    prisma.rfq.count({ where }),
  ]);

  return {
    rfqs,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function listRfqCategoryOptions(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.category.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
    },
  });
}

export async function getRfqOverview(
  session: Session,
  input: Pick<ListRfqsInput, "q" | "vendorId" | "categoryId" | "servicePartnerId" | "dateRange"> = {}
) {
  const where = buildRfqWhere(session, input);
  const rfqs = await prisma.rfq.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      rfqNumber: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      dueDate: true,
      _count: {
        select: {
          vendorQuotes: true,
        },
      },
      items: {
        select: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          item: {
            select: {
              category: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const totalRfqs = rfqs.length;
  let openRfqs = 0;
  let inProgressRfqs = 0;
  let completedRfqs = 0;
  let cancelledRfqs = 0;
  let latestUpdatedAt: Date | null = null;

  const categoryMap = new Map<string, { id: string; name: string; count: number }>();

  for (const rfq of rfqs) {
    if (!latestUpdatedAt || rfq.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = rfq.updatedAt;
    }

    if (rfq.status === RfqStatus.DRAFT || rfq.status === RfqStatus.PUBLISHED) {
      openRfqs += 1;
    } else if (rfq.status === RfqStatus.QUOTING) {
      inProgressRfqs += 1;
    } else if (rfq.status === RfqStatus.CLOSED) {
      completedRfqs += 1;
    } else if (rfq.status === RfqStatus.CANCELLED) {
      cancelledRfqs += 1;
    }

    const firstCategory =
      rfq.items.find((item) => item.category)?.category ??
      rfq.items.find((item) => item.item.category)?.item.category ??
      null;

    const categoryId = firstCategory?.id ?? "others";
    const categoryName = firstCategory?.name ?? "Others";
    const existing = categoryMap.get(categoryId);
    if (existing) {
      existing.count += 1;
    } else {
      categoryMap.set(categoryId, {
        id: categoryId,
        name: categoryName,
        count: 1,
      });
    }
  }

  const statusBreakdown = [
    { key: "open", label: "Open", count: openRfqs, color: "#315cff" },
    { key: "in_progress", label: "In Progress", count: inProgressRfqs, color: "#ff9a1a" },
    { key: "completed", label: "Completed", count: completedRfqs, color: "#21c16b" },
    { key: "cancelled", label: "Cancelled", count: cancelledRfqs, color: "#8d98b6" },
  ] as const;

  const categoryBreakdown = Array.from(categoryMap.values())
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .map((entry, index) => ({
      ...entry,
      color: ["#315cff", "#ff9a1a", "#21c16b", "#8d5bff", "#12a3ff", "#ff6d5a", "#5d76ff", "#8d98b6"][index % 8],
    }))
    .slice(0, 6);

  const recentRfqs = rfqs.slice(0, 5).map((rfq) => ({
    id: rfq.id,
    rfqNumber: rfq.rfqNumber,
    title: rfq.title,
    status: rfq.status,
  }));

  return {
    totalRfqs,
    openRfqs,
    inProgressRfqs,
    completedRfqs,
    cancelledRfqs,
    latestUpdatedAt,
    statusBreakdown,
    categoryBreakdown,
    recentRfqs,
  };
}

export async function getRfqById(session: Session, id: string) {
  return prisma.rfq.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getRfqScopeWhere(session),
    },
    include: {
      servicePartner: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      client: {
        select: {
          id: true,
          code: true,
          name: true,
          servicePartnerId: true,
        },
      },
      serviceRequest: {
        select: {
          id: true,
          serviceNumber: true,
          title: true,
          servicePartnerId: true,
          clientId: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      items: {
        orderBy: [{ itemId: "asc" }],
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              servicePartnerId: true,
              active: true,
            },
          },
        },
      },
      vendorQuotes: {
        orderBy: [{ createdAt: "asc" }],
        include: {
          vendor: {
            select: {
              id: true,
              code: true,
              name: true,
              servicePartnerId: true,
              status: true,
            },
          },
        },
      },
      _count: {
        select: {
          items: true,
          vendorQuotes: true,
        },
      },
    },
  });
}

export async function listRfqServicePartnersForForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return prisma.servicePartner.findMany({
      where: {
        id: session.user.servicePartnerId,
      },
      orderBy: [{ name: "asc" }],
      select: { id: true, code: true, name: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: { id: true, code: true, name: true },
  });
}

export async function listClientsForRfqForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.client.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      servicePartnerId: true,
    },
  });
}

export async function listServiceRequestsForRfqForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.serviceRequest.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      serviceNumber: true,
      title: true,
      servicePartnerId: true,
      clientId: true,
    },
  });
}

export async function listItemsForRfqForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.item.findMany({
    where: {
      deletedAt: null,
      active: true,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      unit: true,
      servicePartnerId: true,
      active: true,
    },
  });
}

export async function listVendorsForRfqForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.vendor.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      servicePartnerId: true,
      status: true,
      isVerified: true,
    },
  });
}

export function getServicePartnerIdForRfqWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

async function generateRfqNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `RFQ-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.rfq.findFirst({
      where: {
        servicePartnerId,
        rfqNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique RFQ number.");
}

async function assertClientTenantConsistency(clientId: string | undefined, servicePartnerId: string) {
  if (!clientId) {
    return null;
  }

  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });

  if (!client) {
    throw new Error("Client not found.");
  }

  if (client.servicePartnerId !== servicePartnerId) {
    throw new Error("Client and service partner mismatch.");
  }

  return client;
}

async function assertServiceRequestTenantConsistency(
  serviceRequestId: string | undefined,
  servicePartnerId: string,
  clientId?: string
) {
  if (!serviceRequestId) {
    return null;
  }

  const serviceRequest = await prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      clientId: true,
    },
  });

  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  if (serviceRequest.servicePartnerId !== servicePartnerId) {
    throw new Error("Service request and service partner mismatch.");
  }

  if (clientId && serviceRequest.clientId !== clientId) {
    throw new Error("Service request and client mismatch.");
  }

  return serviceRequest;
}

async function assertRfqLineItemsTenantConsistency(lines: RfqLineInput[], servicePartnerId: string) {
  const itemIds = Array.from(new Set(lines.map((line) => line.itemId)));

  if (itemIds.length !== lines.length) {
    throw new Error("Duplicate RFQ line item is not allowed.");
  }

  if (itemIds.length === 0) {
    return new Map<
      string,
      {
        id: string;
        name: string;
        unit: string;
      }
    >();
  }

  const items = await prisma.item.findMany({
    where: {
      id: {
        in: itemIds,
      },
      deletedAt: null,
      active: true,
      servicePartnerId,
    },
    select: {
      id: true,
      name: true,
      unit: true,
    },
  });

  if (items.length !== itemIds.length) {
    throw new Error("One or more RFQ line items are invalid for this tenant.");
  }

  return new Map(items.map((item) => [item.id, item]));
}

async function assertRfqVendorsTenantConsistency(vendors: RfqVendorInput[], servicePartnerId: string) {
  const vendorIds = Array.from(new Set(vendors.map((vendor) => vendor.vendorId)));

  if (vendorIds.length !== vendors.length) {
    throw new Error("Duplicate RFQ vendor is not allowed.");
  }

  if (vendorIds.length === 0) {
    return new Map<
      string,
      {
        id: string;
        name: string;
      }
    >();
  }

  const vendorRows = await prisma.vendor.findMany({
    where: {
      id: {
        in: vendorIds,
      },
      deletedAt: null,
      servicePartnerId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (vendorRows.length !== vendorIds.length) {
    throw new Error("One or more RFQ vendors are invalid for this tenant.");
  }

  return new Map(vendorRows.map((vendor) => [vendor.id, vendor]));
}

function toRfqItemsCreateManyInput(
  rfqId: string,
  lines: RfqLineInput[],
  itemById: Map<string, { id: string; name: string; unit: string }>
) {
  return lines.map((line) => {
    const itemName = itemById.get(line.itemId)?.name ?? "Item";
    return {
      rfqId,
      itemId: line.itemId,
      quantity: roundQuantity(line.quantity),
      specs: normalizeOptionalString(line.specs ?? line.description) ?? itemName,
      remarks: normalizeOptionalString(line.remarks),
    };
  });
}

function toRfqVendorsCreateManyInput(
  rfqId: string,
  vendors: RfqVendorInput[],
  vendorById: Map<string, { id: string; name: string }>
) {
  return vendors.map((vendor) => {
    void vendorById.get(vendor.vendorId);
    return {
      rfqId,
      vendorId: vendor.vendorId,
      status: vendor.status ?? RfqVendorStatus.INVITED,
      quotedAmount: vendor.quotedAmount ?? null,
      notes: normalizeOptionalString(vendor.notes),
      submittedAt: vendor.status === RfqVendorStatus.QUOTE_SUBMITTED ? new Date() : null,
    };
  });
}

export async function createRfq(session: Session, input: RfqUpsertInput) {
  const servicePartnerId = getServicePartnerIdForRfqWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const client = await assertClientTenantConsistency(input.clientId, servicePartnerId);
  await assertServiceRequestTenantConsistency(input.serviceRequestId, servicePartnerId, client?.id);

  const itemById = await assertRfqLineItemsTenantConsistency(input.lines, servicePartnerId);
  const vendorById = await assertRfqVendorsTenantConsistency(input.vendors, servicePartnerId);
  const rfqNumber = await generateRfqNumber(servicePartnerId);

  return prisma.$transaction(async (tx) => {
    const rfq = await tx.rfq.create({
      data: {
        servicePartnerId,
        clientId: input.clientId ?? null,
        serviceRequestId: input.serviceRequestId ?? null,
        createdByUserId: session.user.id,
        rfqNumber,
        title: input.title.trim(),
        description: normalizeOptionalString(input.description),
        status: input.status,
        dueDate: input.dueDate ?? null,
      },
    });

    if (input.lines.length > 0) {
      await tx.rfqItem.createMany({
        data: toRfqItemsCreateManyInput(rfq.id, input.lines, itemById),
      });
    }

    if (input.vendors.length > 0) {
      await tx.rfqVendor.createMany({
        data: toRfqVendorsCreateManyInput(rfq.id, input.vendors, vendorById),
      });
    }

    return rfq;
  });
}

export async function updateRfq(session: Session, id: string, input: RfqUpsertInput) {
  const existing = await getRfqById(session, id);
  if (!existing) {
    throw new Error("RFQ not found.");
  }
  assertRfqStatusTransition(existing.status, input.status);

  const servicePartnerId = getServicePartnerIdForRfqWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const client = await assertClientTenantConsistency(input.clientId, servicePartnerId);
  await assertServiceRequestTenantConsistency(input.serviceRequestId, servicePartnerId, client?.id);

  const itemById = await assertRfqLineItemsTenantConsistency(input.lines, servicePartnerId);
  const vendorById = await assertRfqVendorsTenantConsistency(input.vendors, servicePartnerId);

  return prisma.$transaction(async (tx) => {
    const rfq = await tx.rfq.update({
      where: { id },
      data: {
        servicePartnerId,
        clientId: input.clientId ?? null,
        serviceRequestId: input.serviceRequestId ?? null,
        title: input.title.trim(),
        description: normalizeOptionalString(input.description),
        status: input.status,
        dueDate: input.dueDate ?? null,
      },
    });

    await tx.rfqItem.deleteMany({
      where: {
        rfqId: id,
      },
    });

    await tx.rfqVendor.deleteMany({
      where: {
        rfqId: id,
      },
    });

    if (input.lines.length > 0) {
      await tx.rfqItem.createMany({
        data: toRfqItemsCreateManyInput(rfq.id, input.lines, itemById),
      });
    }

    if (input.vendors.length > 0) {
      await tx.rfqVendor.createMany({
        data: toRfqVendorsCreateManyInput(rfq.id, input.vendors, vendorById),
      });
    }

    return rfq;
  });
}

export async function updateRfqStatus(session: Session, id: string, status: RfqStatus) {
  const existing = await getRfqById(session, id);
  if (!existing) {
    throw new Error("RFQ not found.");
  }
  assertRfqStatusTransition(existing.status, status);

  return prisma.rfq.update({
    where: { id },
    data: {
      status,
    },
  });
}

export async function sendRfqToVendors(session: Session, id: string) {
  const existing = await getRfqById(session, id);
  if (!existing) {
    throw new Error("RFQ not found.");
  }
  assertRfqStatusTransition(existing.status, RfqStatus.PUBLISHED);

  if (existing.items.length === 0) {
    throw new Error("RFQ cannot be sent without at least one line item.");
  }

  if (existing.vendorQuotes.length === 0) {
    throw new Error("RFQ cannot be sent without at least one vendor.");
  }

  return prisma.$transaction(async (tx) => {
    const rfq = await tx.rfq.update({
      where: { id },
      data: {
        status: RfqStatus.PUBLISHED,
      },
    });

    await tx.rfqVendor.updateMany({
      where: {
        rfqId: id,
        status: RfqVendorStatus.INVITED,
      },
      data: {
        status: RfqVendorStatus.QUOTING,
      },
    });

    return rfq;
  });
}

export async function softDeleteRfq(session: Session, id: string) {
  const existing = await getRfqById(session, id);
  if (!existing) {
    throw new Error("RFQ not found.");
  }

  return prisma.rfq.update({
    where: { id },
    data: {
      status: RfqStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });
}

export async function updateRfqVendorQuote(session: Session, rfqId: string, input: RfqVendorInput) {
  const existing = await getRfqById(session, rfqId);
  if (!existing) {
    throw new Error("RFQ not found.");
  }

  const allowedVendorIds = new Set(existing.vendorQuotes.map((quote) => quote.vendorId));
  if (!allowedVendorIds.has(input.vendorId)) {
    throw new Error("RFQ vendor not found.");
  }

  const existingVendorQuote = existing.vendorQuotes.find((quote) => quote.vendorId === input.vendorId);
  if (!existingVendorQuote) {
    throw new Error("RFQ vendor not found.");
  }

  const nextStatus = input.status ?? RfqVendorStatus.QUOTE_SUBMITTED;
  assertRfqVendorStatusTransition(existingVendorQuote.status, nextStatus);

  if (input.quotedAmount !== undefined && input.quotedAmount < 0) {
    throw new Error("Quoted amount cannot be negative.");
  }
  if ((nextStatus === RfqVendorStatus.QUOTE_SUBMITTED || nextStatus === RfqVendorStatus.SELECTED) && input.quotedAmount === undefined) {
    throw new Error("Quoted amount is required when quote is submitted or selected.");
  }

  const submittedAt =
    nextStatus === RfqVendorStatus.QUOTE_SUBMITTED || nextStatus === RfqVendorStatus.SELECTED
      ? new Date()
      : nextStatus === RfqVendorStatus.INVITED || nextStatus === RfqVendorStatus.QUOTING
        ? null
        : existingVendorQuote.submittedAt;

  return prisma.rfqVendor.update({
    where: {
      rfqId_vendorId: {
        rfqId,
        vendorId: input.vendorId,
      },
    },
    data: {
      status: nextStatus,
      quotedAmount: input.quotedAmount ?? null,
      notes: normalizeOptionalString(input.notes),
      submittedAt,
    },
  });
}
