import { Prisma, PurchaseOrderStatus, VendorStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { PurchaseOrderItemInput, PurchaseOrderUpsertInput } from "@/features/purchase-orders/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListPurchaseOrdersInput = {
  q?: string;
  status?: PurchaseOrderStatus;
  statusGroup?: PurchaseOrderStatusGroup;
  vendorId?: string;
  categoryId?: string;
  dateRange?: PurchaseOrderDateRange;
  servicePartnerId?: string;
  page?: number;
  pageSize?: number;
};

export type PurchaseOrderStatusGroup = "open" | "partially_received" | "completed" | "cancelled";
export type PurchaseOrderDateRange = "today" | "this_week" | "this_month" | "overdue";

const purchaseOrderStatusTransitionMap: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  [PurchaseOrderStatus.DRAFT]: [
    PurchaseOrderStatus.DRAFT,
    PurchaseOrderStatus.APPROVAL_PENDING,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.APPROVAL_PENDING]: [
    PurchaseOrderStatus.APPROVAL_PENDING,
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.REJECTED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.APPROVED]: [
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.ISSUED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.REJECTED]: [
    PurchaseOrderStatus.REJECTED,
    PurchaseOrderStatus.APPROVAL_PENDING,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.ISSUED]: [
    PurchaseOrderStatus.ISSUED,
    PurchaseOrderStatus.PARTIALLY_FULFILLED,
    PurchaseOrderStatus.FULFILLED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.PARTIALLY_FULFILLED]: [
    PurchaseOrderStatus.PARTIALLY_FULFILLED,
    PurchaseOrderStatus.FULFILLED,
    PurchaseOrderStatus.CANCELLED,
  ],
  [PurchaseOrderStatus.FULFILLED]: [PurchaseOrderStatus.FULFILLED],
  [PurchaseOrderStatus.CANCELLED]: [PurchaseOrderStatus.CANCELLED],
};

function assertPurchaseOrderStatusTransition(currentStatus: PurchaseOrderStatus, nextStatus: PurchaseOrderStatus) {
  const allowedStatuses = purchaseOrderStatusTransitionMap[currentStatus] ?? [currentStatus];
  if (!allowedStatuses.includes(nextStatus)) {
    throw new Error(`Purchase order status transition is not allowed: ${currentStatus} -> ${nextStatus}.`);
  }
}

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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type ComputedLine = {
  itemId: string;
  quantity: number;
  unitRate: number;
  taxPercent: number | null;
  amount: number;
  subtotal: number;
  taxAmount: number;
};

function computeLines(lines: PurchaseOrderItemInput[]) {
  const computedLines: ComputedLine[] = [];
  let subtotal = 0;
  let taxTotal = 0;
  let grandTotal = 0;

  for (const line of lines) {
    const quantity = roundQuantity(line.quantity);
    const unitRate = roundMoney(line.unitRate);
    const taxPercent = line.taxPercent === undefined ? null : roundMoney(line.taxPercent);

    const lineSubtotal = roundMoney(quantity * unitRate);
    const lineTax = roundMoney(lineSubtotal * ((taxPercent ?? 0) / 100));
    const lineAmount = roundMoney(lineSubtotal + lineTax);

    subtotal = roundMoney(subtotal + lineSubtotal);
    taxTotal = roundMoney(taxTotal + lineTax);
    grandTotal = roundMoney(grandTotal + lineAmount);

    computedLines.push({
      itemId: line.itemId,
      quantity,
      unitRate,
      taxPercent,
      amount: lineAmount,
      subtotal: lineSubtotal,
      taxAmount: lineTax,
    });
  }

  return { computedLines, subtotal, taxTotal, grandTotal };
}

async function generatePoNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `PO-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.purchaseOrder.findFirst({
      where: {
        servicePartnerId,
        poNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique PO number.");
}

export function getPurchaseOrderScopeWhere(session: Session): Prisma.PurchaseOrderWhereInput {
  return scopeByTenant(session, {});
}

function getStatusesForGroup(group: PurchaseOrderStatusGroup) {
  if (group === "open") {
    return [
      PurchaseOrderStatus.DRAFT,
      PurchaseOrderStatus.APPROVAL_PENDING,
      PurchaseOrderStatus.APPROVED,
      PurchaseOrderStatus.REJECTED,
      PurchaseOrderStatus.ISSUED,
    ];
  }
  if (group === "partially_received") {
    return [PurchaseOrderStatus.PARTIALLY_FULFILLED];
  }
  if (group === "completed") {
    return [PurchaseOrderStatus.FULFILLED];
  }
  return [PurchaseOrderStatus.CANCELLED];
}

function buildPurchaseOrderWhere(
  session: Session,
  input: Pick<ListPurchaseOrdersInput, "q" | "status" | "statusGroup" | "vendorId" | "categoryId" | "dateRange" | "servicePartnerId">
): Prisma.PurchaseOrderWhereInput {
  const where: Prisma.PurchaseOrderWhereInput = {
    ...getPurchaseOrderScopeWhere(session),
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
    where.vendorId = input.vendorId.trim();
  }

  if (input.categoryId?.trim()) {
    where.items = {
      some: {
        item: {
          categoryId: input.categoryId.trim(),
        },
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
      where.orderDate = {
        gte: startToday,
        lte: endToday,
      };
    } else if (input.dateRange === "this_week") {
      const endWeek = new Date(startToday);
      endWeek.setDate(endWeek.getDate() + 7);
      endWeek.setHours(23, 59, 59, 999);
      where.orderDate = {
        gte: startToday,
        lte: endWeek,
      };
    } else if (input.dateRange === "this_month") {
      const endMonth = new Date(startToday.getFullYear(), startToday.getMonth() + 1, 0, 23, 59, 59, 999);
      where.orderDate = {
        gte: startToday,
        lte: endMonth,
      };
    } else if (input.dateRange === "overdue") {
      where.expectedDate = {
        lt: now,
      };
      where.status = {
        notIn: [PurchaseOrderStatus.FULFILLED, PurchaseOrderStatus.CANCELLED],
      };
    }
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { poNumber: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
      {
        items: {
          some: {
            OR: [
              {
                item: {
                  name: { contains: q, mode: "insensitive" },
                },
              },
              {
                item: {
                  category: {
                    name: { contains: q, mode: "insensitive" },
                  },
                },
              },
            ],
          },
        },
      },
    ];
  }

  return where;
}

export async function listPurchaseOrders(session: Session, input: ListPurchaseOrdersInput) {
  const pagination = getPagination(input);
  const where = buildPurchaseOrderWhere(session, input);

  const [purchaseOrders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
      include: {
        servicePartner: {
          select: { id: true, code: true, name: true },
        },
        vendor: {
          select: { id: true, code: true, name: true },
        },
        serviceRequest: {
          select: { id: true, serviceNumber: true, title: true },
        },
        items: {
          take: 3,
          orderBy: [{ itemId: "asc" }],
          select: {
            quantity: true,
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
          select: { items: true },
        },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return {
    purchaseOrders,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function listPurchaseOrderCategoryOptions(session: Session, servicePartnerId?: string) {
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

export async function getPurchaseOrderOverview(
  session: Session,
  input: Pick<ListPurchaseOrdersInput, "q" | "vendorId" | "categoryId" | "dateRange" | "servicePartnerId"> = {}
) {
  const where = buildPurchaseOrderWhere(session, input);
  const purchaseOrders = await prisma.purchaseOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      poNumber: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      orderDate: true,
      expectedDate: true,
      vendor: {
        select: {
          name: true,
        },
      },
      items: {
        select: {
          quantity: true,
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

  const totalPurchaseOrders = purchaseOrders.length;
  let openPurchaseOrders = 0;
  let partiallyReceivedPurchaseOrders = 0;
  let completedPurchaseOrders = 0;
  let cancelledPurchaseOrders = 0;
  let latestUpdatedAt: Date | null = null;

  const categoryMap = new Map<string, { id: string; name: string; count: number }>();

  for (const purchaseOrder of purchaseOrders) {
    if (!latestUpdatedAt || purchaseOrder.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = purchaseOrder.updatedAt;
    }

    if (
      purchaseOrder.status === PurchaseOrderStatus.DRAFT ||
      purchaseOrder.status === PurchaseOrderStatus.APPROVAL_PENDING ||
      purchaseOrder.status === PurchaseOrderStatus.APPROVED ||
      purchaseOrder.status === PurchaseOrderStatus.REJECTED ||
      purchaseOrder.status === PurchaseOrderStatus.ISSUED
    ) {
      openPurchaseOrders += 1;
    } else if (purchaseOrder.status === PurchaseOrderStatus.PARTIALLY_FULFILLED) {
      partiallyReceivedPurchaseOrders += 1;
    } else if (purchaseOrder.status === PurchaseOrderStatus.FULFILLED) {
      completedPurchaseOrders += 1;
    } else if (purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
      cancelledPurchaseOrders += 1;
    }

    const category = purchaseOrder.items.find((item) => item.item.category)?.item.category ?? null;
    const categoryId = category?.id ?? "others";
    const categoryName = category?.name ?? "Others";
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
    { key: "open", label: "Open", count: openPurchaseOrders, color: "#315cff" },
    { key: "partially_received", label: "Partially Received", count: partiallyReceivedPurchaseOrders, color: "#ff9a1a" },
    { key: "completed", label: "Completed", count: completedPurchaseOrders, color: "#21c16b" },
    { key: "cancelled", label: "Cancelled", count: cancelledPurchaseOrders, color: "#8d98b6" },
  ] as const;

  const categoryBreakdown = Array.from(categoryMap.values())
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .map((entry, index) => ({
      ...entry,
      color: ["#315cff", "#ff9a1a", "#21c16b", "#8d5bff", "#12a3ff", "#ff6d5a", "#5d76ff", "#8d98b6"][index % 8],
    }))
    .slice(0, 8);

  const recentPurchaseOrders = purchaseOrders.slice(0, 5).map((purchaseOrder) => ({
    id: purchaseOrder.id,
    poNumber: purchaseOrder.poNumber,
    status: purchaseOrder.status,
    vendorName: purchaseOrder.vendor.name,
  }));

  return {
    totalPurchaseOrders,
    openPurchaseOrders,
    partiallyReceivedPurchaseOrders,
    completedPurchaseOrders,
    cancelledPurchaseOrders,
    latestUpdatedAt,
    statusBreakdown,
    categoryBreakdown,
    recentPurchaseOrders,
  };
}

export async function getPurchaseOrderById(session: Session, id: string) {
  return prisma.purchaseOrder.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getPurchaseOrderScopeWhere(session),
    },
    include: {
      servicePartner: {
        select: { id: true, code: true, name: true },
      },
      vendor: {
        select: { id: true, code: true, name: true, status: true, isVerified: true },
      },
      rfq: {
        select: { id: true, rfqNumber: true, title: true, status: true, servicePartnerId: true },
      },
      serviceRequest: {
        select: { id: true, serviceNumber: true, title: true, servicePartnerId: true },
      },
      createdBy: {
        select: { id: true, name: true, email: true, phone: true },
      },
      approvedBy: {
        select: { id: true, name: true, email: true, phone: true },
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
      _count: {
        select: { items: true },
      },
    },
  });
}

export async function listPurchaseOrderServicePartnersForForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return prisma.servicePartner.findMany({
      where: { id: session.user.servicePartnerId },
      orderBy: [{ name: "asc" }],
      select: { id: true, code: true, name: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: { deletedAt: null },
    orderBy: [{ name: "asc" }],
    select: { id: true, code: true, name: true },
  });
}

export async function listVendorsForPurchaseOrderForm(session: Session, servicePartnerId?: string) {
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

export async function listRfqsForPurchaseOrderForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.rfq.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      rfqNumber: true,
      title: true,
      servicePartnerId: true,
      serviceRequestId: true,
      status: true,
      vendorQuotes: {
        select: {
          vendorId: true,
        },
      },
    },
  });
}

export async function listServiceRequestsForPurchaseOrderForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.serviceRequest.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      serviceNumber: true,
      title: true,
      servicePartnerId: true,
    },
  });
}

export async function listItemsForPurchaseOrderForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.item.findMany({
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
      unit: true,
      active: true,
      servicePartnerId: true,
    },
  });
}

export function getServicePartnerIdForPurchaseOrderWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }
  return inputServicePartnerId;
}

async function assertVendorTenantConsistency(vendorId: string, servicePartnerId: string) {
  const vendor = await prisma.vendor.findFirst({
    where: {
      id: vendorId,
      servicePartnerId,
      status: VendorStatus.ACTIVE,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!vendor) {
    throw new Error("Vendor is invalid for this tenant.");
  }
}

async function assertServiceRequestTenantConsistency(serviceRequestId: string | undefined, servicePartnerId: string) {
  if (!serviceRequestId) {
    return null;
  }

  const serviceRequest = await prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!serviceRequest) {
    throw new Error("Service request is invalid for this tenant.");
  }

  return serviceRequest;
}

async function assertRfqTenantConsistency(
  rfqId: string | undefined,
  servicePartnerId: string,
  vendorId: string,
  serviceRequestId?: string
) {
  if (!rfqId) {
    return null;
  }

  const rfq = await prisma.rfq.findFirst({
    where: {
      id: rfqId,
      servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
      serviceRequestId: true,
      vendorQuotes: {
        select: {
          vendorId: true,
        },
      },
    },
  });

  if (!rfq) {
    throw new Error("RFQ is invalid for this tenant.");
  }

  const allowedVendorIds = new Set(rfq.vendorQuotes.map((quote) => quote.vendorId));
  if (allowedVendorIds.size > 0 && !allowedVendorIds.has(vendorId)) {
    throw new Error("Selected vendor is not part of the RFQ.");
  }

  if (serviceRequestId && rfq.serviceRequestId && rfq.serviceRequestId !== serviceRequestId) {
    throw new Error("RFQ and service request mismatch.");
  }

  return rfq;
}

async function assertPurchaseOrderItemsTenantConsistency(lines: PurchaseOrderItemInput[], servicePartnerId: string) {
  const itemIds = Array.from(new Set(lines.map((line) => line.itemId)));
  if (itemIds.length === 0) {
    return new Map<string, { id: string }>();
  }

  const itemRows = await prisma.item.findMany({
    where: {
      id: { in: itemIds },
      servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (itemRows.length !== itemIds.length) {
    throw new Error("One or more PO items are invalid for this tenant.");
  }

  return new Map(itemRows.map((item) => [item.id, item]));
}

function toPurchaseOrderItemsCreateManyInput(purchaseOrderId: string, lines: ComputedLine[]) {
  return lines.map((line) => ({
    purchaseOrderId,
    itemId: line.itemId,
    quantity: line.quantity,
    unitRate: line.unitRate,
    taxPercent: line.taxPercent,
    amount: line.amount,
  }));
}

function getApprovalFields(status: PurchaseOrderStatus, session: Session, existing?: { approvedByUserId: string | null; approvedAt: Date | null }) {
  if (status === PurchaseOrderStatus.APPROVED) {
    return {
      approvedByUserId: existing?.approvedByUserId ?? session.user.id,
      approvedAt: existing?.approvedAt ?? new Date(),
    };
  }

  if (!existing) {
    return {
      approvedByUserId: null,
      approvedAt: null,
    };
  }

  return {
    approvedByUserId: existing.approvedByUserId,
    approvedAt: existing.approvedAt,
  };
}

export async function createPurchaseOrder(session: Session, input: PurchaseOrderUpsertInput) {
  const servicePartnerId = getServicePartnerIdForPurchaseOrderWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertVendorTenantConsistency(input.vendorId, servicePartnerId);
  await assertServiceRequestTenantConsistency(input.serviceRequestId, servicePartnerId);
  await assertRfqTenantConsistency(input.rfqId, servicePartnerId, input.vendorId, input.serviceRequestId);
  await assertPurchaseOrderItemsTenantConsistency(input.items, servicePartnerId);

  const poNumber = await generatePoNumber(servicePartnerId);
  const { computedLines, subtotal, taxTotal, grandTotal } = computeLines(input.items);
  const approvalFields = getApprovalFields(input.status, session);

  return prisma.$transaction(async (tx) => {
    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        servicePartnerId,
        rfqId: input.rfqId ?? null,
        serviceRequestId: input.serviceRequestId ?? null,
        vendorId: input.vendorId,
        poNumber,
        status: input.status,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate ?? null,
        subtotal,
        taxTotal,
        grandTotal,
        notes: normalizeOptionalString(input.notes),
        createdByUserId: session.user.id,
        ...approvalFields,
      },
    });

    await tx.purchaseOrderItem.createMany({
      data: toPurchaseOrderItemsCreateManyInput(purchaseOrder.id, computedLines),
    });

    return purchaseOrder;
  });
}

export async function updatePurchaseOrder(session: Session, id: string, input: PurchaseOrderUpsertInput) {
  const existing = await getPurchaseOrderById(session, id);
  if (!existing) {
    throw new Error("Purchase order not found.");
  }
  assertPurchaseOrderStatusTransition(existing.status, input.status);

  const servicePartnerId = getServicePartnerIdForPurchaseOrderWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertVendorTenantConsistency(input.vendorId, servicePartnerId);
  await assertServiceRequestTenantConsistency(input.serviceRequestId, servicePartnerId);
  await assertRfqTenantConsistency(input.rfqId, servicePartnerId, input.vendorId, input.serviceRequestId);
  await assertPurchaseOrderItemsTenantConsistency(input.items, servicePartnerId);

  const { computedLines, subtotal, taxTotal, grandTotal } = computeLines(input.items);
  const approvalFields = getApprovalFields(input.status, session, {
    approvedByUserId: existing.approvedByUserId,
    approvedAt: existing.approvedAt,
  });

  return prisma.$transaction(async (tx) => {
    const purchaseOrder = await tx.purchaseOrder.update({
      where: { id },
      data: {
        servicePartnerId,
        rfqId: input.rfqId ?? null,
        serviceRequestId: input.serviceRequestId ?? null,
        vendorId: input.vendorId,
        status: input.status,
        orderDate: input.orderDate,
        expectedDate: input.expectedDate ?? null,
        subtotal,
        taxTotal,
        grandTotal,
        notes: normalizeOptionalString(input.notes),
        ...approvalFields,
      },
    });

    await tx.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: id },
    });

    await tx.purchaseOrderItem.createMany({
      data: toPurchaseOrderItemsCreateManyInput(id, computedLines),
    });

    return purchaseOrder;
  });
}

export async function updatePurchaseOrderStatus(session: Session, id: string, status: PurchaseOrderStatus) {
  const existing = await getPurchaseOrderById(session, id);
  if (!existing) {
    throw new Error("Purchase order not found.");
  }

  assertPurchaseOrderStatusTransition(existing.status, status);
  const approvalFields = getApprovalFields(status, session, {
    approvedByUserId: existing.approvedByUserId,
    approvedAt: existing.approvedAt,
  });

  return prisma.purchaseOrder.update({
    where: { id },
    data: {
      status,
      ...approvalFields,
    },
  });
}

export async function softDeletePurchaseOrder(session: Session, id: string) {
  const existing = await getPurchaseOrderById(session, id);
  if (!existing) {
    throw new Error("Purchase order not found.");
  }

  return prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: PurchaseOrderStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });
}
