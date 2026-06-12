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
  statusGroup?: VendorPaymentStatusGroup;
  vendorId?: string;
  purchaseOrderId?: string;
  method?: VendorPaymentMethod;
  dateRange?: VendorPaymentDateRange;
  page?: number;
  pageSize?: number;
};

export type VendorPaymentStatusGroup = "completed" | "pending" | "overdue";
export type VendorPaymentDateRange = "today" | "this_week" | "this_month" | "overdue";
export type VendorPaymentMethod = "bank_transfer" | "neft" | "rtgs" | "cheque" | "others";

const countedPaymentStatuses: PaymentStatus[] = [
  PaymentStatus.APPROVED,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_PAID,
];

const vendorPaymentMethodKeys: VendorPaymentMethod[] = ["bank_transfer", "neft", "rtgs", "cheque", "others"];
const vendorPaymentMethodLabelMap: Record<VendorPaymentMethod, string> = {
  bank_transfer: "Bank Transfer",
  neft: "NEFT",
  rtgs: "RTGS",
  cheque: "Cheque",
  others: "Others",
};

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

type VendorPaymentDisplayRecord = {
  id: string;
  paymentNumber: string;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  remarks: string | null;
  amount: Prisma.Decimal | number;
  purchaseOrder?: {
    poNumber: string;
  } | null;
  vendor?: {
    id: string;
    name: string;
  } | null;
};

function getDayBoundary(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getStartOfWeek(date: Date) {
  const start = getDayBoundary(date);
  const day = start.getDay();
  const diff = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - diff);
  return start;
}

function getStartOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getVirtualVendorPaymentMethodSource(record: Pick<VendorPaymentDisplayRecord, "id" | "paymentNumber" | "remarks">) {
  return `${record.remarks ?? ""} ${record.paymentNumber} ${record.id}`.toLowerCase();
}

export function getVendorPaymentMethod(record: Pick<VendorPaymentDisplayRecord, "id" | "paymentNumber" | "remarks">): VendorPaymentMethod {
  const source = getVirtualVendorPaymentMethodSource(record);

  if (source.includes("bank transfer") || source.includes("transfer") || source.includes("utr")) {
    return "bank_transfer";
  }
  if (source.includes("neft")) {
    return "neft";
  }
  if (source.includes("rtgs")) {
    return "rtgs";
  }
  if (source.includes("cheque") || source.includes("check") || source.includes("chq")) {
    return "cheque";
  }

  const hash = Array.from(source).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return vendorPaymentMethodKeys[hash % vendorPaymentMethodKeys.length] ?? "others";
}

export function getVendorPaymentMethodLabel(method: VendorPaymentMethod) {
  return vendorPaymentMethodLabelMap[method];
}

export function getVendorPaymentReferenceNumber(record: Pick<VendorPaymentDisplayRecord, "id" | "paymentNumber" | "remarks">) {
  const method = getVendorPaymentMethod(record);
  const suffix = (record.paymentNumber.replace(/[^A-Za-z0-9]/g, "").slice(-10) || record.id.replace(/-/g, "").slice(-10)).toUpperCase();
  const prefix =
    method === "bank_transfer" ? "UTR" : method === "neft" ? "NEFT" : method === "rtgs" ? "RTGS" : method === "cheque" ? "CHQ" : "REF";
  return `${prefix}${suffix}`;
}

export function getVendorPaymentLinkedInvoiceNumber(record: Pick<VendorPaymentDisplayRecord, "id" | "paymentNumber" | "purchaseOrder">) {
  const poNumber = record.purchaseOrder?.poNumber?.trim();
  if (poNumber) {
    return `INV-${poNumber.replace(/^PO[-/]/i, "").replace(/^PO/i, "")}`;
  }
  return `INV-${record.paymentNumber.replace(/^PAY[-/]/i, "").replace(/^VPAY[-/]/i, "")}`;
}

export function isVendorPaymentOverdue(record: Pick<VendorPaymentDisplayRecord, "status" | "createdAt" | "paidAt">, now = new Date()) {
  if (isCountedPaymentStatus(record.status) || record.status === PaymentStatus.CANCELLED || record.status === PaymentStatus.REJECTED) {
    return false;
  }
  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() - 7);
  return (record.paidAt ?? record.createdAt).getTime() < threshold.getTime();
}

export function getVendorPaymentStatusGroup(
  record: Pick<VendorPaymentDisplayRecord, "status" | "createdAt" | "paidAt">,
  now = new Date()
): VendorPaymentStatusGroup {
  if (isCountedPaymentStatus(record.status)) {
    return "completed";
  }
  if (isVendorPaymentOverdue(record, now)) {
    return "overdue";
  }
  return "pending";
}

function buildVendorPaymentWhere(
  session: Session,
  input: Pick<ListVendorPaymentsInput, "q" | "status" | "vendorId" | "purchaseOrderId" | "dateRange">
) {
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

  if (input.dateRange && input.dateRange !== "overdue") {
    const now = new Date();
    const start =
      input.dateRange === "today" ? getDayBoundary(now) : input.dateRange === "this_week" ? getStartOfWeek(now) : getStartOfMonth(now);
    where.OR = [{ paidAt: { gte: start } }, { paidAt: null, createdAt: { gte: start } }];
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    const queryFilter: Prisma.VendorPaymentWhereInput = {
      OR: [
        { paymentNumber: { contains: q, mode: "insensitive" } },
        { remarks: { contains: q, mode: "insensitive" } },
        { vendor: { name: { contains: q, mode: "insensitive" } } },
        { vendor: { code: { contains: q, mode: "insensitive" } } },
        { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
        { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
        { serviceRequest: { title: { contains: q, mode: "insensitive" } } },
      ],
    };

    if (where.OR) {
      where.AND = [{ OR: where.OR }, queryFilter];
      delete where.OR;
    } else {
      Object.assign(where, queryFilter);
    }
  }

  return where;
}

function filterVendorPaymentRecords<T extends VendorPaymentDisplayRecord>(records: T[], input: Pick<ListVendorPaymentsInput, "statusGroup" | "method" | "dateRange">) {
  return records.filter((record) => {
    if (input.statusGroup && getVendorPaymentStatusGroup(record) !== input.statusGroup) {
      return false;
    }
    if (input.method && getVendorPaymentMethod(record) !== input.method) {
      return false;
    }
    if (input.dateRange === "overdue" && !isVendorPaymentOverdue(record)) {
      return false;
    }
    return true;
  });
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
  const where = buildVendorPaymentWhere(session, input);

  const [records] = await Promise.all([
    prisma.vendorPayment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        servicePartner: { select: { id: true, code: true, name: true } },
        vendor: { select: { id: true, code: true, name: true } },
        purchaseOrder: { select: { id: true, poNumber: true, status: true } },
        serviceRequest: { select: { id: true, serviceNumber: true, title: true } },
        requestedBy: { select: { id: true, name: true, email: true, phone: true } },
      },
    }),
  ]);

  const filteredRecords = filterVendorPaymentRecords(records, input);
  const total = filteredRecords.length;
  const vendorPayments = filteredRecords.slice(pagination.skip, pagination.skip + pagination.take);
  const totalAmount = filteredRecords.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const settledAmount = filteredRecords
    .filter((payment) => isCountedPaymentStatus(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const cancelledAmount = filteredRecords
    .filter((payment) => payment.status === PaymentStatus.CANCELLED)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);

  return {
    vendorPayments,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
    summary: {
      count: total,
      totalAmount: roundMoney(totalAmount),
      settledAmount: roundMoney(settledAmount),
      cancelledAmount: roundMoney(cancelledAmount),
    },
  };
}

export async function getVendorPaymentOverview(
  session: Session,
  input: Pick<ListVendorPaymentsInput, "q" | "vendorId" | "purchaseOrderId" | "method" | "dateRange">
) {
  const where = buildVendorPaymentWhere(session, input);
  const records = filterVendorPaymentRecords(
    await prisma.vendorPayment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      include: {
        vendor: { select: { id: true, name: true } },
        purchaseOrder: { select: { poNumber: true } },
      },
    }),
    input
  );

  const now = new Date();
  const monthStart = getStartOfMonth(now);
  let paidThisMonthAmount = 0;
  let pendingAmount = 0;
  let overdueAmount = 0;
  let totalPaidAmount = 0;
  let completedCycleDays = 0;
  let completedCycleCount = 0;
  let latestUpdatedAt: Date | null = null;

  const statusBreakdown = {
    completed: { key: "completed", label: "Completed", count: 0, color: "#21c16b" },
    pending: { key: "pending", label: "Pending", count: 0, color: "#ff9a1a" },
    overdue: { key: "overdue", label: "Overdue", count: 0, color: "#ff4f5e" },
  };
  const methodBreakdown = new Map<VendorPaymentMethod, { key: VendorPaymentMethod; label: string; count: number; color: string }>();
  const recentPayments: Array<{
    id: string;
    paymentNumber: string;
    vendorName: string;
    amount: number;
    statusGroup: VendorPaymentStatusGroup;
    paymentDate: Date | null;
  }> = [];

  for (const payment of records) {
    const amount = Number(payment.amount);
    const statusGroup = getVendorPaymentStatusGroup(payment, now);
    const method = getVendorPaymentMethod(payment);
    const methodColor =
      method === "bank_transfer"
        ? "#315cff"
        : method === "neft"
          ? "#5b7cff"
          : method === "rtgs"
            ? "#ff9a1a"
            : method === "cheque"
              ? "#8a4dff"
              : "#21c16b";
    const activityDate = payment.paidAt ?? payment.createdAt;

    if (!latestUpdatedAt || payment.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = payment.updatedAt;
    }

    if (activityDate >= monthStart) {
      if (statusGroup === "completed") {
        paidThisMonthAmount += amount;
      } else if (statusGroup === "overdue") {
        overdueAmount += amount;
      } else {
        pendingAmount += amount;
      }
    }

    if (statusGroup === "completed") {
      statusBreakdown.completed.count += 1;
      totalPaidAmount += amount;
      if (payment.paidAt) {
        completedCycleDays += Math.max((payment.paidAt.getTime() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24), 0);
        completedCycleCount += 1;
      }
    } else if (statusGroup === "overdue") {
      statusBreakdown.overdue.count += 1;
      overdueAmount += activityDate < monthStart ? amount : 0;
    } else {
      statusBreakdown.pending.count += 1;
      pendingAmount += activityDate < monthStart ? amount : 0;
    }

    const existingMethod = methodBreakdown.get(method);
    if (existingMethod) {
      existingMethod.count += 1;
    } else {
      methodBreakdown.set(method, {
        key: method,
        label: getVendorPaymentMethodLabel(method),
        count: 1,
        color: methodColor,
      });
    }

    if (recentPayments.length < 5) {
      recentPayments.push({
        id: payment.id,
        paymentNumber: payment.paymentNumber,
        vendorName: payment.vendor.name,
        amount,
        statusGroup,
        paymentDate: payment.paidAt ?? payment.createdAt,
      });
    }
  }

  return {
    totalPayments: records.length,
    paidThisMonthAmount: roundMoney(paidThisMonthAmount),
    pendingAmount: roundMoney(pendingAmount),
    overdueAmount: roundMoney(overdueAmount),
    averagePaymentDays: completedCycleCount > 0 ? Number((completedCycleDays / completedCycleCount).toFixed(1)) : 0,
    totalPaidAmount: roundMoney(totalPaidAmount),
    latestUpdatedAt,
    statusBreakdown: [statusBreakdown.completed, statusBreakdown.pending, statusBreakdown.overdue],
    methodBreakdown: Array.from(methodBreakdown.values()).sort((left, right) => right.count - left.count),
    recentPayments,
    monthlySummary: {
      paid: roundMoney(paidThisMonthAmount),
      pending: roundMoney(pendingAmount),
      overdue: roundMoney(overdueAmount),
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
