import { InvoiceStatus, Prisma, PurchaseOrderStatus, VendorStatus } from "@prisma/client";
import type { Session } from "next-auth";

import { invoiceUpsertSchema, type InvoiceLineInput, type InvoiceUpsertInput } from "@/features/invoices/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { measurePerf } from "@/lib/observability/perf";

type ListInvoicesInput = {
  q?: string;
  status?: InvoiceStatus;
  vendorId?: string;
  purchaseOrderId?: string;
  page?: number;
  pageSize?: number;
};

const invoiceStatusTransitionMap: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  [InvoiceStatus.DRAFT]: [InvoiceStatus.DRAFT, InvoiceStatus.SUBMITTED, InvoiceStatus.APPROVAL_PENDING, InvoiceStatus.CANCELLED],
  [InvoiceStatus.SUBMITTED]: [InvoiceStatus.SUBMITTED, InvoiceStatus.APPROVAL_PENDING, InvoiceStatus.REJECTED, InvoiceStatus.CANCELLED],
  [InvoiceStatus.APPROVAL_PENDING]: [
    InvoiceStatus.APPROVAL_PENDING,
    InvoiceStatus.APPROVED,
    InvoiceStatus.REJECTED,
    InvoiceStatus.CANCELLED,
  ],
  [InvoiceStatus.APPROVED]: [InvoiceStatus.APPROVED, InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
  [InvoiceStatus.REJECTED]: [InvoiceStatus.REJECTED, InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PARTIALLY_PAID]: [InvoiceStatus.PARTIALLY_PAID, InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
  [InvoiceStatus.PAID]: [InvoiceStatus.PAID],
  [InvoiceStatus.CANCELLED]: [InvoiceStatus.CANCELLED],
};

const editableInvoiceStatuses = new Set<InvoiceStatus>([
  InvoiceStatus.DRAFT,
  InvoiceStatus.SUBMITTED,
  InvoiceStatus.APPROVAL_PENDING,
  InvoiceStatus.REJECTED,
  InvoiceStatus.APPROVED,
]);

const poStatusesAllowedForInvoiceCreation = new Set<PurchaseOrderStatus>([
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_FULFILLED,
  PurchaseOrderStatus.FULFILLED,
]);

function assertInvoiceStatusTransition(currentStatus: InvoiceStatus, nextStatus: InvoiceStatus) {
  const allowedStatuses = invoiceStatusTransitionMap[currentStatus] ?? [currentStatus];
  if (!allowedStatuses.includes(nextStatus)) {
    throw new Error(`Invoice status transition is not allowed: ${currentStatus} -> ${nextStatus}.`);
  }
}

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function normalizeRequiredString(value: string) {
  return value.trim();
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

function assertValidInvoiceInput(input: InvoiceUpsertInput) {
  const parsed = invoiceUpsertSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invoice input validation failed.");
  }
  return parsed.data;
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

function computeLines(lines: InvoiceLineInput[]) {
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

async function generateInvoiceNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `INV-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.invoice.findFirst({
      where: {
        servicePartnerId,
        invoiceNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique invoice number.");
}

async function assertVendorInvoiceNumberAvailable(input: {
  servicePartnerId: string;
  vendorId: string;
  vendorInvoiceNumber: string;
  excludeInvoiceId?: string;
}) {
  const existing = await prisma.invoice.findFirst({
    where: {
      servicePartnerId: input.servicePartnerId,
      vendorId: input.vendorId,
      deletedAt: null,
      ...(input.excludeInvoiceId ? { id: { not: input.excludeInvoiceId } } : {}),
      vendorInvoiceNumber: {
        equals: input.vendorInvoiceNumber,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
    },
  });

  if (existing) {
    throw new Error("Vendor invoice number already exists for this vendor.");
  }
}

export function getInvoiceScopeWhere(session: Session): Prisma.InvoiceWhereInput {
  return scopeByTenant(session, {});
}

export async function listInvoices(session: Session, input: ListInvoicesInput) {
  return measurePerf("invoices.list", async () => {
    const pagination = getPagination(input);
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        vendorId: input.vendorId?.trim() || null,
        purchaseOrderId: input.purchaseOrderId?.trim() || null,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");
    const where: Prisma.InvoiceWhereInput = {
      ...getInvoiceScopeWhere(session),
      deletedAt: null,
    };

    if (input.status) {
      where.status = input.status;
    }

    if (input.vendorId?.trim()) {
      where.vendorId = input.vendorId;
    }

    if (input.purchaseOrderId?.trim()) {
      where.purchaseOrderId = input.purchaseOrderId;
    }

    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { vendorInvoiceNumber: { contains: q, mode: "insensitive" } },
        { invoiceNumber: { contains: q, mode: "insensitive" } },
        { notes: { contains: q, mode: "insensitive" } },
        { vendor: { name: { contains: q, mode: "insensitive" } } },
        { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
        { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
      ];
    }

    const loadInvoices = async () => {
      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy: [{ createdAt: "desc" }],
          include: {
            servicePartner: { select: { id: true, code: true, name: true } },
            vendor: { select: { id: true, code: true, name: true } },
            purchaseOrder: { select: { id: true, poNumber: true, status: true } },
            serviceRequest: { select: { id: true, serviceNumber: true, title: true } },
            _count: { select: { items: true } },
          },
        }),
        prisma.invoice.count({ where }),
      ]);

      return {
        invoices,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: getTotalPages(total, pagination.pageSize),
      };
    };

    if (pagination.page === 1) {
      return getOrSetServerCache("invoices.list", cacheKey, loadInvoices, {
        ttlSeconds: 20,
        prefixes: [cachePrefixes.invoices, `${cachePrefixes.invoices}:tenant:${session.user.servicePartnerId}`],
      });
    }

    return loadInvoices();
  });
}

export async function getInvoiceById(session: Session, id: string) {
  return prisma.invoice.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getInvoiceScopeWhere(session),
    },
    include: {
      servicePartner: { select: { id: true, code: true, name: true } },
      vendor: { select: { id: true, code: true, name: true, status: true, isVerified: true } },
      purchaseOrder: { select: { id: true, poNumber: true, status: true, servicePartnerId: true } },
      rfq: { select: { id: true, rfqNumber: true, title: true, servicePartnerId: true } },
      serviceRequest: { select: { id: true, serviceNumber: true, title: true, servicePartnerId: true } },
      createdBy: { select: { id: true, name: true, email: true, phone: true } },
      approvedBy: { select: { id: true, name: true, email: true, phone: true } },
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
      _count: { select: { items: true } },
    },
  });
}

export async function listInvoicesForPurchaseOrder(session: Session, purchaseOrderId: string) {
  return prisma.invoice.findMany({
    where: {
      deletedAt: null,
      purchaseOrderId,
      ...getInvoiceScopeWhere(session),
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      vendorInvoiceNumber: true,
      invoiceNumber: true,
      status: true,
      invoiceDate: true,
      receivedDate: true,
      grandTotal: true,
      _count: {
        select: {
          items: true,
        },
      },
    },
  });
}

export async function listInvoiceServicePartnersForForm(session: Session) {
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

export async function listVendorsForInvoiceForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return getOrSetServerCache(
    "options.invoice_vendors",
    `${session.user.id}:${resolvedServicePartnerId ?? "all"}`,
    () =>
      prisma.vendor.findMany({
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
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
}

export async function listPurchaseOrdersForInvoiceForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.purchaseOrder.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      poNumber: true,
      servicePartnerId: true,
      vendorId: true,
      rfqId: true,
      serviceRequestId: true,
      status: true,
      vendor: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });
}

export async function listRfqsForInvoiceForm(session: Session, servicePartnerId?: string) {
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

export async function listServiceRequestsForInvoiceForm(session: Session, servicePartnerId?: string) {
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

export async function listItemsForInvoiceForm(session: Session, servicePartnerId?: string) {
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

export function getServicePartnerIdForInvoiceWrite(session: Session, inputServicePartnerId?: string) {
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
    select: { id: true },
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
    select: { id: true },
  });

  if (!serviceRequest) {
    throw new Error("Service request is invalid for this tenant.");
  }

  return serviceRequest;
}

async function assertRfqTenantConsistency(rfqId: string | undefined, servicePartnerId: string, vendorId: string, serviceRequestId?: string) {
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
        select: { vendorId: true },
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

async function assertPurchaseOrderTenantConsistency(
  purchaseOrderId: string | undefined,
  servicePartnerId: string,
  vendorId: string,
  rfqId?: string,
  serviceRequestId?: string
) {
  if (!purchaseOrderId) {
    return null;
  }

  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      vendorId: true,
      rfqId: true,
      serviceRequestId: true,
    },
  });

  if (!purchaseOrder) {
    throw new Error("Purchase order is invalid for this tenant.");
  }

  if (!poStatusesAllowedForInvoiceCreation.has(purchaseOrder.status)) {
    throw new Error("Purchase order status is not eligible for invoice creation.");
  }

  if (purchaseOrder.vendorId !== vendorId) {
    throw new Error("Purchase order vendor mismatch.");
  }

  if (rfqId && purchaseOrder.rfqId && rfqId !== purchaseOrder.rfqId) {
    throw new Error("Purchase order and RFQ mismatch.");
  }

  if (serviceRequestId && purchaseOrder.serviceRequestId && serviceRequestId !== purchaseOrder.serviceRequestId) {
    throw new Error("Purchase order and service request mismatch.");
  }

  return purchaseOrder;
}

async function assertInvoiceItemsTenantConsistency(lines: InvoiceLineInput[], servicePartnerId: string) {
  const itemIds = Array.from(new Set(lines.map((line) => line.itemId)));
  if (itemIds.length === 0) {
    return new Map<string, { id: string }>();
  }

  const itemRows = await prisma.item.findMany({
    where: {
      id: { in: itemIds },
      servicePartnerId,
      active: true,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (itemRows.length !== itemIds.length) {
    throw new Error("One or more invoice items are invalid for this tenant.");
  }

  return new Map(itemRows.map((item) => [item.id, item]));
}

function toInvoiceItemsCreateManyInput(invoiceId: string, lines: ComputedLine[]) {
  return lines.map((line) => ({
    invoiceId,
    itemId: line.itemId,
    quantity: line.quantity,
    unitRate: line.unitRate,
    taxPercent: line.taxPercent,
    amount: line.amount,
  }));
}

function getApprovalFields(status: InvoiceStatus, session: Session, existing?: { approvedByUserId: string | null; approvedAt: Date | null }) {
  if (status === InvoiceStatus.APPROVED) {
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

export async function createInvoice(session: Session, input: InvoiceUpsertInput) {
  const normalizedInput = assertValidInvoiceInput(input);
  const servicePartnerId = getServicePartnerIdForInvoiceWrite(session, normalizedInput.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const purchaseOrder = await assertPurchaseOrderTenantConsistency(
    normalizedInput.purchaseOrderId,
    servicePartnerId,
    normalizedInput.vendorId,
    normalizedInput.rfqId,
    normalizedInput.serviceRequestId
  );

  const resolvedVendorId = purchaseOrder?.vendorId ?? normalizedInput.vendorId;
  const resolvedRfqId = normalizedInput.rfqId ?? purchaseOrder?.rfqId ?? undefined;
  const resolvedServiceRequestId = normalizedInput.serviceRequestId ?? purchaseOrder?.serviceRequestId ?? undefined;

  await assertVendorTenantConsistency(resolvedVendorId, servicePartnerId);
  await assertServiceRequestTenantConsistency(resolvedServiceRequestId, servicePartnerId);
  await assertRfqTenantConsistency(resolvedRfqId, servicePartnerId, resolvedVendorId, resolvedServiceRequestId);
  await assertInvoiceItemsTenantConsistency(normalizedInput.items, servicePartnerId);
  const vendorInvoiceNumber = normalizeRequiredString(normalizedInput.vendorInvoiceNumber);
  await assertVendorInvoiceNumberAvailable({
    servicePartnerId,
    vendorId: resolvedVendorId,
    vendorInvoiceNumber,
  });

  const invoiceNumber = await generateInvoiceNumber(servicePartnerId);
  const { computedLines, subtotal, taxTotal, grandTotal } = computeLines(normalizedInput.items);
  const approvalFields = getApprovalFields(normalizedInput.status, session);

  const invoice = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        servicePartnerId,
        vendorId: resolvedVendorId,
        purchaseOrderId: purchaseOrder?.id ?? normalizedInput.purchaseOrderId ?? null,
        rfqId: resolvedRfqId ?? null,
        serviceRequestId: resolvedServiceRequestId ?? null,
        vendorInvoiceNumber,
        invoiceNumber,
        status: normalizedInput.status,
        invoiceDate: normalizedInput.invoiceDate,
        receivedDate: normalizedInput.receivedDate,
        dueDate: normalizedInput.dueDate ?? null,
        subtotal,
        taxTotal,
        grandTotal,
        notes: normalizeOptionalString(normalizedInput.notes),
        createdByUserId: session.user.id,
        ...approvalFields,
      },
    });

    await tx.invoiceItem.createMany({
      data: toInvoiceItemsCreateManyInput(invoice.id, computedLines),
    });

    return invoice;
  });

  await invalidateTenantDataCaches(servicePartnerId);
  return invoice;
}

export async function updateInvoice(session: Session, id: string, input: InvoiceUpsertInput) {
  const normalizedInput = assertValidInvoiceInput(input);
  const existing = await getInvoiceById(session, id);
  if (!existing) {
    throw new Error("Invoice not found.");
  }

  if (!editableInvoiceStatuses.has(existing.status)) {
    throw new Error("Invoice cannot be edited in the current status.");
  }

  assertInvoiceStatusTransition(existing.status, normalizedInput.status);

  const servicePartnerId = getServicePartnerIdForInvoiceWrite(session, normalizedInput.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const purchaseOrder = await assertPurchaseOrderTenantConsistency(
    normalizedInput.purchaseOrderId,
    servicePartnerId,
    normalizedInput.vendorId,
    normalizedInput.rfqId,
    normalizedInput.serviceRequestId
  );

  const resolvedVendorId = purchaseOrder?.vendorId ?? normalizedInput.vendorId;
  const resolvedRfqId = normalizedInput.rfqId ?? purchaseOrder?.rfqId ?? undefined;
  const resolvedServiceRequestId = normalizedInput.serviceRequestId ?? purchaseOrder?.serviceRequestId ?? undefined;

  await assertVendorTenantConsistency(resolvedVendorId, servicePartnerId);
  await assertServiceRequestTenantConsistency(resolvedServiceRequestId, servicePartnerId);
  await assertRfqTenantConsistency(resolvedRfqId, servicePartnerId, resolvedVendorId, resolvedServiceRequestId);
  await assertInvoiceItemsTenantConsistency(normalizedInput.items, servicePartnerId);
  const vendorInvoiceNumber = normalizeRequiredString(normalizedInput.vendorInvoiceNumber);
  await assertVendorInvoiceNumberAvailable({
    servicePartnerId,
    vendorId: resolvedVendorId,
    vendorInvoiceNumber,
    excludeInvoiceId: existing.id,
  });

  const { computedLines, subtotal, taxTotal, grandTotal } = computeLines(normalizedInput.items);
  const approvalFields = getApprovalFields(normalizedInput.status, session, {
    approvedByUserId: existing.approvedByUserId,
    approvedAt: existing.approvedAt,
  });

  const invoice = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.update({
      where: { id },
      data: {
        servicePartnerId,
        vendorId: resolvedVendorId,
        purchaseOrderId: purchaseOrder?.id ?? normalizedInput.purchaseOrderId ?? null,
        rfqId: resolvedRfqId ?? null,
        serviceRequestId: resolvedServiceRequestId ?? null,
        vendorInvoiceNumber,
        status: normalizedInput.status,
        invoiceDate: normalizedInput.invoiceDate,
        receivedDate: normalizedInput.receivedDate,
        dueDate: normalizedInput.dueDate ?? null,
        subtotal,
        taxTotal,
        grandTotal,
        notes: normalizeOptionalString(normalizedInput.notes),
        ...approvalFields,
      },
    });

    await tx.invoiceItem.deleteMany({
      where: { invoiceId: id },
    });

    await tx.invoiceItem.createMany({
      data: toInvoiceItemsCreateManyInput(invoice.id, computedLines),
    });

    return invoice;
  });

  await invalidateTenantDataCaches(servicePartnerId);
  return invoice;
}

export async function updateInvoiceStatus(session: Session, id: string, status: InvoiceStatus) {
  const existing = await getInvoiceById(session, id);
  if (!existing) {
    throw new Error("Invoice not found.");
  }

  assertInvoiceStatusTransition(existing.status, status);
  const approvalFields = getApprovalFields(status, session, {
    approvedByUserId: existing.approvedByUserId,
    approvedAt: existing.approvedAt,
  });

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      status,
      ...approvalFields,
    },
  });

  await invalidateTenantDataCaches(existing.servicePartnerId);
  return invoice;
}

export async function softDeleteInvoice(session: Session, id: string) {
  const existing = await getInvoiceById(session, id);
  if (!existing) {
    throw new Error("Invoice not found.");
  }

  const invoice = await prisma.invoice.update({
    where: { id },
    data: {
      status: InvoiceStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });

  await invalidateTenantDataCaches(existing.servicePartnerId);
  return invoice;
}
