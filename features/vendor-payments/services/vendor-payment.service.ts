import { PaymentStatus, Prisma, PurchaseOrderStatus, VendorStatus } from "@prisma/client";
import type { Session } from "next-auth";

import { syncLedgerForVendorPayment } from "@/features/ledger/services/ledger.service";
import type {
  CreateVendorPaymentInput,
  UpdateVendorPaymentInput,
  UpdateVendorPaymentStatusInput,
} from "@/features/vendor-payments/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListVendorPaymentsInput = {
  q?: string;
  status?: PaymentStatus;
  vendorId?: string;
  purchaseOrderId?: string;
  page?: number;
  pageSize?: number;
};

const countedPaymentStatuses: PaymentStatus[] = [
  PaymentStatus.APPROVED,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_PAID,
];

const vendorPaymentEligiblePoStatuses = new Set<PurchaseOrderStatus>([
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_FULFILLED,
  PurchaseOrderStatus.FULFILLED,
]);

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toYyyyMmDd(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function isCountedPaymentStatus(status: PaymentStatus) {
  return countedPaymentStatuses.includes(status);
}

type DbLike = Prisma.TransactionClient | typeof prisma;

async function generateVendorPaymentNumber(tx: DbLike, servicePartnerId: string) {
  const servicePartner = await tx.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `VPAY-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await tx.vendorPayment.findFirst({
      where: {
        servicePartnerId,
        paymentNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique vendor payment number.");
}

export function getVendorPaymentScopeWhere(session: Session): Prisma.VendorPaymentWhereInput {
  return scopeByTenant(session, {});
}

export function getServicePartnerIdForVendorPaymentWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }
  return inputServicePartnerId;
}

async function assertVendorTenantConsistency(vendorId: string, servicePartnerId: string, tx: DbLike = prisma) {
  const vendor = await tx.vendor.findFirst({
    where: {
      id: vendorId,
      servicePartnerId,
      status: VendorStatus.ACTIVE,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      code: true,
      name: true,
    },
  });

  if (!vendor) {
    throw new Error("Vendor is invalid for this tenant.");
  }

  return vendor;
}

async function assertPurchaseOrderTenantConsistency(
  purchaseOrderId: string | undefined,
  servicePartnerId: string,
  vendorId?: string,
  tx: DbLike = prisma
) {
  if (!purchaseOrderId) {
    return null;
  }

  const purchaseOrder = await tx.purchaseOrder.findFirst({
    where: {
      id: purchaseOrderId,
      servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
      poNumber: true,
      vendorId: true,
      serviceRequestId: true,
      status: true,
    },
  });

  if (!purchaseOrder) {
    throw new Error("Purchase order is invalid for this tenant.");
  }

  if (!vendorPaymentEligiblePoStatuses.has(purchaseOrder.status)) {
    throw new Error("Purchase order status is not eligible for vendor payments.");
  }

  if (vendorId && purchaseOrder.vendorId !== vendorId) {
    throw new Error("Purchase order vendor mismatch.");
  }

  return purchaseOrder;
}

async function getVendorPaymentByIdForScope(session: Session, vendorPaymentId: string, tx: DbLike = prisma) {
  return tx.vendorPayment.findFirst({
    where: {
      id: vendorPaymentId,
      ...getVendorPaymentScopeWhere(session),
    },
    select: {
      id: true,
      servicePartnerId: true,
      vendorId: true,
      purchaseOrderId: true,
      amount: true,
      status: true,
    },
  });
}

export async function listVendorPayments(session: Session, input: ListVendorPaymentsInput) {
  const pagination = getPagination(input);
  const where: Prisma.VendorPaymentWhereInput = {
    ...getVendorPaymentScopeWhere(session),
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
      { paymentNumber: { contains: q, mode: "insensitive" } },
      { remarks: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { vendor: { code: { contains: q, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [vendorPayments, total, aggregateTotal, aggregateSettled, aggregateCancelled] = await Promise.all([
    prisma.vendorPayment.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
      include: {
        servicePartner: { select: { id: true, code: true, name: true } },
        vendor: { select: { id: true, code: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        serviceRequest: { select: { id: true, serviceNumber: true, title: true } },
        requestedBy: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
    prisma.vendorPayment.count({ where }),
    prisma.vendorPayment.aggregate({
      where,
      _sum: { amount: true },
    }),
    prisma.vendorPayment.aggregate({
      where: {
        ...where,
        status: { in: countedPaymentStatuses },
      },
      _sum: { amount: true },
    }),
    prisma.vendorPayment.aggregate({
      where: {
        ...where,
        status: PaymentStatus.CANCELLED,
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    vendorPayments,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
    summary: {
      count: total,
      totalAmount: roundMoney(Number(aggregateTotal._sum.amount ?? 0)),
      settledAmount: roundMoney(Number(aggregateSettled._sum.amount ?? 0)),
      cancelledAmount: roundMoney(Number(aggregateCancelled._sum.amount ?? 0)),
    },
  };
}

export async function getVendorPaymentById(session: Session, id: string) {
  return prisma.vendorPayment.findFirst({
    where: {
      id,
      ...getVendorPaymentScopeWhere(session),
    },
    include: {
      servicePartner: { select: { id: true, code: true, name: true } },
      vendor: { select: { id: true, code: true, name: true, status: true, isVerified: true } },
      purchaseOrder: { select: { id: true, poNumber: true, status: true, servicePartnerId: true } },
      serviceRequest: { select: { id: true, serviceNumber: true, title: true, servicePartnerId: true } },
      requestedBy: { select: { id: true, name: true, email: true, phone: true } },
      approvedBy: { select: { id: true, name: true, email: true, phone: true } },
      paidBy: { select: { id: true, name: true, email: true, phone: true } },
      ledgerEntries: {
        orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          sourceType: true,
          entryDate: true,
          debitAmount: true,
          creditAmount: true,
          description: true,
        },
      },
    },
  });
}

export async function listVendorPaymentServicePartnersForForm(session: Session) {
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

export async function listVendorsForVendorPaymentForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.vendor.findMany({
    where: {
      deletedAt: null,
      status: VendorStatus.ACTIVE,
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

export async function listPurchaseOrdersForVendorPaymentForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.purchaseOrder.findMany({
    where: {
      deletedAt: null,
      status: { in: Array.from(vendorPaymentEligiblePoStatuses) },
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      poNumber: true,
      servicePartnerId: true,
      vendorId: true,
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

export async function listVendorPaymentsForPurchaseOrder(session: Session, purchaseOrderId: string) {
  return prisma.vendorPayment.findMany({
    where: {
      purchaseOrderId,
      ...getVendorPaymentScopeWhere(session),
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      paymentNumber: true,
      status: true,
      amount: true,
      paidAt: true,
      vendor: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      requestedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      updatedAt: true,
    },
  });
}

export async function createVendorPayment(session: Session, input: CreateVendorPaymentInput) {
  const servicePartnerId = getServicePartnerIdForVendorPaymentWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const purchaseOrder = await assertPurchaseOrderTenantConsistency(input.purchaseOrderId, servicePartnerId, input.vendorId);
  const resolvedVendorId = purchaseOrder?.vendorId ?? input.vendorId;
  const resolvedServiceRequestId = purchaseOrder?.serviceRequestId ?? null;
  await assertVendorTenantConsistency(resolvedVendorId, servicePartnerId);
  const amount = roundMoney(input.amount);

  return prisma.$transaction(async (tx) => {
    const paymentNumber = await generateVendorPaymentNumber(tx, servicePartnerId);
    const vendorPayment = await tx.vendorPayment.create({
      data: {
        servicePartnerId,
        vendorId: resolvedVendorId,
        purchaseOrderId: purchaseOrder?.id ?? input.purchaseOrderId ?? null,
        serviceRequestId: resolvedServiceRequestId,
        paymentNumber,
        status: input.status,
        amount,
        approvedAmount: isCountedPaymentStatus(input.status) ? amount : null,
        requestedByUserId: session.user.id,
        approvedByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidAt: isCountedPaymentStatus(input.status) ? input.paymentDate : null,
        remarks: normalizeOptionalString(input.notes),
      },
    });

    const ledger = await syncLedgerForVendorPayment(tx, {
      vendorPaymentId: vendorPayment.id,
      actorUserId: session.user.id,
    });

    return {
      vendorPayment,
      ledger,
    };
  });
}

export async function updateVendorPayment(session: Session, vendorPaymentId: string, input: UpdateVendorPaymentInput) {
  const existing = await getVendorPaymentByIdForScope(session, vendorPaymentId);
  if (!existing) {
    throw new Error("Vendor payment not found.");
  }

  const servicePartnerId = existing.servicePartnerId;

  const purchaseOrder = await assertPurchaseOrderTenantConsistency(input.purchaseOrderId, servicePartnerId, input.vendorId);
  const resolvedVendorId = purchaseOrder?.vendorId ?? input.vendorId;
  const resolvedServiceRequestId = purchaseOrder?.serviceRequestId ?? null;
  await assertVendorTenantConsistency(resolvedVendorId, servicePartnerId);
  const amount = roundMoney(input.amount);

  return prisma.$transaction(async (tx) => {
    const vendorPayment = await tx.vendorPayment.update({
      where: { id: existing.id },
      data: {
        servicePartnerId,
        vendorId: resolvedVendorId,
        purchaseOrderId: purchaseOrder?.id ?? input.purchaseOrderId ?? null,
        serviceRequestId: resolvedServiceRequestId,
        status: input.status,
        amount,
        approvedAmount: isCountedPaymentStatus(input.status) ? amount : null,
        approvedByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidAt: isCountedPaymentStatus(input.status) ? input.paymentDate : null,
        remarks: normalizeOptionalString(input.notes),
      },
    });

    const ledger = await syncLedgerForVendorPayment(tx, {
      vendorPaymentId: vendorPayment.id,
      actorUserId: session.user.id,
    });

    return {
      vendorPayment,
      ledger,
    };
  });
}

export async function updateVendorPaymentStatus(session: Session, vendorPaymentId: string, input: UpdateVendorPaymentStatusInput) {
  const existing = await getVendorPaymentByIdForScope(session, vendorPaymentId);
  if (!existing) {
    throw new Error("Vendor payment not found.");
  }

  return prisma.$transaction(async (tx) => {
    const currentAmount = roundMoney(Number(existing.amount));
    const vendorPayment = await tx.vendorPayment.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        approvedAmount: isCountedPaymentStatus(input.status) ? currentAmount : null,
        approvedByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidAt: isCountedPaymentStatus(input.status) ? new Date() : null,
      },
    });

    const ledger = await syncLedgerForVendorPayment(tx, {
      vendorPaymentId: vendorPayment.id,
      actorUserId: session.user.id,
    });

    return {
      vendorPayment,
      ledger,
    };
  });
}

export async function voidVendorPayment(session: Session, vendorPaymentId: string) {
  const existing = await getVendorPaymentByIdForScope(session, vendorPaymentId);
  if (!existing) {
    throw new Error("Vendor payment not found.");
  }

  return prisma.$transaction(async (tx) => {
    const vendorPayment = await tx.vendorPayment.update({
      where: { id: existing.id },
      data: {
        status: PaymentStatus.CANCELLED,
        approvedAmount: null,
        approvedByUserId: null,
        paidByUserId: null,
        paidAt: null,
      },
    });

    const ledger = await syncLedgerForVendorPayment(tx, {
      vendorPaymentId: vendorPayment.id,
      actorUserId: session.user.id,
    });

    return {
      vendorPayment,
      ledger,
    };
  });
}
