import {
  InvoiceStatus,
  PaymentStatus,
  PurchaseOrderStatus,
  ServiceRequestStatus,
  TaskStatus,
  type Prisma,
} from "@prisma/client";
import type { Session } from "next-auth";

import { getFinanceReportData } from "@/features/finance-reports/services/finance-report.service";
import { listTasks } from "@/features/tasks/services/task.service";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import type { ExportRow } from "@/lib/export/csv";

export type ExportModuleKey =
  | "activity-logs"
  | "clients"
  | "service-requests"
  | "tasks"
  | "quotations"
  | "purchase-orders"
  | "invoices"
  | "payments"
  | "ledger"
  | "vendor-payments"
  | "finance-reports";

type SearchParamsLike = URLSearchParams;

function getStringParam(searchParams: SearchParamsLike, key: string) {
  const value = searchParams.get(key);
  return value?.trim() || undefined;
}

function getDateParam(searchParams: SearchParamsLike, key: string) {
  const value = getStringParam(searchParams, key);
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function toStatus<T extends string>(value: string | undefined, allowed: readonly T[]) {
  return value && allowed.includes(value as T) ? (value as T) : undefined;
}

function toRowDate(value: Date | null | undefined) {
  return value ? value.toISOString() : "";
}

export function getExportPermissionKey(moduleKey: ExportModuleKey) {
  const permissionMap: Record<ExportModuleKey, string> = {
    "activity-logs": "activity_logs.export",
    clients: "clients.export",
    "service-requests": "service_requests.export",
    tasks: "tasks.export",
    quotations: "quotations.export",
    "purchase-orders": "purchase_orders.export",
    invoices: "invoices.export",
    payments: "payments.export",
    ledger: "ledger.export",
    "vendor-payments": "vendor_payments.export",
    "finance-reports": "reports.export",
  };

  return permissionMap[moduleKey];
}

export async function getExportRows(session: Session, moduleKey: ExportModuleKey, searchParams: SearchParamsLike): Promise<ExportRow[]> {
  switch (moduleKey) {
    case "activity-logs":
      return getActivityLogRows(session, searchParams);
    case "clients":
      return getClientRows(session, searchParams);
    case "service-requests":
      return getServiceRequestRows(session, searchParams);
    case "tasks":
      return getTaskRows(session, searchParams);
    case "quotations":
      return getQuotationRows(session, searchParams);
    case "purchase-orders":
      return getPurchaseOrderRows(session, searchParams);
    case "invoices":
      return getInvoiceRows(session, searchParams);
    case "payments":
      return getPaymentRows(session, searchParams);
    case "ledger":
      return getLedgerRows(session, searchParams);
    case "vendor-payments":
      return getVendorPaymentRows(session, searchParams);
    case "finance-reports":
      return getFinanceReportRows(session, searchParams);
    default:
      return [];
  }
}

async function getActivityLogRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const action = getStringParam(searchParams, "action");
  const moduleFilter = getStringParam(searchParams, "module");
  const actorUserId = getStringParam(searchParams, "actorUserId");
  const dateFrom = getDateParam(searchParams, "dateFrom");
  const dateTo = getDateParam(searchParams, "dateTo");

  const where: Prisma.ActivityLogWhereInput = {
    ...scopeByTenant(session as never, {}),
  };

  if (action) {
    where.action = action;
  }
  if (moduleFilter) {
    where.module = moduleFilter;
  }
  if (actorUserId) {
    where.actorUserId = actorUserId;
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) {
      where.createdAt.gte = startOfDay(dateFrom);
    }
    if (dateTo) {
      where.createdAt.lte = endOfDay(dateTo);
    }
  }
  if (q) {
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { module: { contains: q, mode: "insensitive" } },
      { message: { contains: q, mode: "insensitive" } },
      { entityId: { contains: q, mode: "insensitive" } },
      { actor: { name: { contains: q, mode: "insensitive" } } },
      { actor: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.activityLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      actor: {
        select: {
          name: true,
          email: true,
        },
      },
      servicePartner: {
        select: {
          name: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    timestamp: toRowDate(row.createdAt),
    company: row.servicePartner.name,
    actor: row.actor?.name || row.actor?.email || "",
    module: row.module,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    message: row.message,
  }));
}

async function getClientRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const status = getStringParam(searchParams, "status");
  const servicePartnerId = getStringParam(searchParams, "servicePartnerId");

  const where: Prisma.ClientWhereInput = {
    ...scopeByTenant(session as never, {}),
    deletedAt: null,
  };

  if (status) {
    where.status = status as never;
  }
  if (session.user.isSuperAdmin && servicePartnerId) {
    where.servicePartnerId = servicePartnerId;
  }
  if (q) {
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.client.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      servicePartner: {
        select: {
          name: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    company: row.servicePartner.name,
    status: row.status,
    email: row.email,
    phone: row.phone,
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getServiceRequestRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const status = toStatus(getStringParam(searchParams, "status"), Object.values(ServiceRequestStatus));
  const clientId = getStringParam(searchParams, "clientId");
  const branchId = getStringParam(searchParams, "branchId");

  const where: Prisma.ServiceRequestWhereInput = {
    ...scopeByTenant(session as never, {}),
    deletedAt: null,
  };

  if (status) {
    where.status = status;
  }
  if (clientId) {
    where.clientId = clientId;
  }
  if (branchId) {
    where.branchId = branchId;
  }
  if (q) {
    where.OR = [
      { serviceNumber: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { serviceType: { contains: q, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.serviceRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      servicePartner: { select: { name: true } },
      client: { select: { name: true, code: true } },
      branch: { select: { name: true, code: true } },
    },
  });

  return rows.map((row) => ({
    serviceNumber: row.serviceNumber,
    title: row.title,
    company: row.servicePartner.name,
    client: `${row.client.name} (${row.client.code})`,
    branch: row.branch ? `${row.branch.name} (${row.branch.code})` : "",
    status: row.status,
    requestedAt: toRowDate(row.requestedAt),
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getTaskRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const status = toStatus(getStringParam(searchParams, "status"), Object.values(TaskStatus));
  const serviceRequestId = getStringParam(searchParams, "serviceRequestId");
  const assigneeUserId = getStringParam(searchParams, "assigneeUserId");
  const assignedByUserId = getStringParam(searchParams, "assignedByUserId");
  const requestedFrom = getDateParam(searchParams, "requestedFrom");
  const requestedTo = getDateParam(searchParams, "requestedTo");
  const dueFrom = getDateParam(searchParams, "dueFrom");
  const dueTo = getDateParam(searchParams, "dueTo");
  const overdue = getStringParam(searchParams, "overdue") === "true";
  const scope = getStringParam(searchParams, "scope") as "all" | "my" | "delegated" | "downline" | "company" | undefined;

  const result = await listTasks(session as never, {
    q,
    status,
    serviceRequestId,
    assigneeUserId,
    assignedByUserId,
    requestedFrom,
    requestedTo,
    dueFrom,
    dueTo,
    overdue,
    scope,
  });

  return result.tasks.map((row) => ({
    taskNumber: row.taskNumber,
    serviceRequest: row.serviceRequestSummary.serviceNumber,
    title: row.title,
    parentTask: row.parentTaskSummary?.taskNumber || "",
    hierarchyLevel: row.hierarchyDepth,
    status: row.status,
    assignee: row.assignee?.name || row.assignee?.email || "",
    assignedBy: row.assignedBy?.name || row.assignedBy?.email || "",
    createdBy: row.createdBy?.name || row.createdBy?.email || "",
    requestedAt: toRowDate(row.requestedAt),
    dueDate: toRowDate(row.dueDate),
    createdAt: toRowDate(row.createdAt),
    assignmentChain: row.assignmentChain.join(" | "),
  }));
}

async function getQuotationRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");

  const rows = await prisma.quotation.findMany({
    where: {
      ...scopeByTenant(session as never, {}),
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { quotationNumber: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
              { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      serviceRequest: { select: { serviceNumber: true, title: true } },
      preparedBy: { select: { name: true, email: true } },
    },
  });

  return rows.map((row) => ({
    quotationNumber: row.quotationNumber,
    serviceRequest: row.serviceRequest.serviceNumber,
    title: row.serviceRequest.title,
    status: row.status,
    grandTotal: Number(row.grandTotal),
    preparedBy: row.preparedBy?.name || row.preparedBy?.email || "",
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getPurchaseOrderRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const vendorId = getStringParam(searchParams, "vendorId");
  const status = toStatus(getStringParam(searchParams, "status"), Object.values(PurchaseOrderStatus));

  const where: Prisma.PurchaseOrderWhereInput = {
    ...scopeByTenant(session as never, {}),
    deletedAt: null,
  };

  if (status) {
    where.status = status;
  }
  if (vendorId) {
    where.vendorId = vendorId;
  }
  if (q) {
    where.OR = [
      { poNumber: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.purchaseOrder.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      vendor: { select: { name: true, code: true } },
      serviceRequest: { select: { serviceNumber: true } },
    },
  });

  return rows.map((row) => ({
    poNumber: row.poNumber,
    status: row.status,
    vendor: `${row.vendor.name} (${row.vendor.code})`,
    serviceRequest: row.serviceRequest?.serviceNumber || "",
    orderDate: toRowDate(row.orderDate),
    grandTotal: Number(row.grandTotal),
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getInvoiceRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const vendorId = getStringParam(searchParams, "vendorId");
  const status = toStatus(getStringParam(searchParams, "status"), Object.values(InvoiceStatus));

  const where: Prisma.InvoiceWhereInput = {
    ...scopeByTenant(session as never, {}),
    deletedAt: null,
  };

  if (status) {
    where.status = status;
  }
  if (vendorId) {
    where.vendorId = vendorId;
  }
  if (q) {
    where.OR = [
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      vendor: { select: { name: true, code: true } },
      serviceRequest: { select: { serviceNumber: true } },
    },
  });

  return rows.map((row) => ({
    invoiceNumber: row.invoiceNumber,
    status: row.status,
    vendor: `${row.vendor.name} (${row.vendor.code})`,
    serviceRequest: row.serviceRequest?.serviceNumber || "",
    invoiceDate: toRowDate(row.invoiceDate),
    dueDate: toRowDate(row.dueDate),
    grandTotal: Number(row.grandTotal),
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getPaymentRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const status = toStatus(getStringParam(searchParams, "status"), Object.values(PaymentStatus));

  const where: Prisma.PaymentWhereInput = {
    ...scopeByTenant(session as never, {}),
    invoiceId: { not: null },
  };

  if (status) {
    where.status = status;
  }
  if (q) {
    where.OR = [
      { paymentNumber: { contains: q, mode: "insensitive" } },
      { referenceNumber: { contains: q, mode: "insensitive" } },
      { remarks: { contains: q, mode: "insensitive" } },
      { invoice: { invoiceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.payment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      invoice: { select: { invoiceNumber: true } },
    },
  });

  return rows.map((row) => ({
    paymentNumber: row.paymentNumber,
    invoiceNumber: row.invoice?.invoiceNumber || "",
    status: row.status,
    amount: Number(row.amount),
    mode: row.mode,
    referenceNumber: row.referenceNumber,
    paidAt: toRowDate(row.paidAt),
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getLedgerRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const dateFrom = getDateParam(searchParams, "dateFrom");
  const dateTo = getDateParam(searchParams, "dateTo");

  const where: Prisma.LedgerEntryWhereInput = {
    ...scopeByTenant(session as never, {}),
  };

  if (dateFrom || dateTo) {
    where.entryDate = {};
    if (dateFrom) {
      where.entryDate.gte = startOfDay(dateFrom);
    }
    if (dateTo) {
      where.entryDate.lte = endOfDay(dateTo);
    }
  }
  if (q) {
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { payment: { paymentNumber: { contains: q, mode: "insensitive" } } },
      { vendorPayment: { paymentNumber: { contains: q, mode: "insensitive" } } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.ledgerEntry.findMany({
    where,
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    include: {
      payment: { select: { paymentNumber: true } },
      vendorPayment: { select: { paymentNumber: true } },
      serviceRequest: { select: { serviceNumber: true } },
    },
  });

  return rows.map((row) => ({
    entryDate: toRowDate(row.entryDate),
    sourceType: row.sourceType,
    paymentNumber: row.payment?.paymentNumber || "",
    vendorPaymentNumber: row.vendorPayment?.paymentNumber || "",
    serviceRequest: row.serviceRequest?.serviceNumber || "",
    debitAmount: Number(row.debitAmount),
    creditAmount: Number(row.creditAmount),
    description: row.description,
  }));
}

async function getVendorPaymentRows(session: Session, searchParams: SearchParamsLike) {
  const q = getStringParam(searchParams, "q");
  const status = toStatus(getStringParam(searchParams, "status"), Object.values(PaymentStatus));
  const vendorId = getStringParam(searchParams, "vendorId");

  const where: Prisma.VendorPaymentWhereInput = {
    ...scopeByTenant(session as never, {}),
  };

  if (status) {
    where.status = status;
  }
  if (vendorId) {
    where.vendorId = vendorId;
  }
  if (q) {
    where.OR = [
      { paymentNumber: { contains: q, mode: "insensitive" } },
      { remarks: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const rows = await prisma.vendorPayment.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: {
      vendor: { select: { name: true, code: true } },
      purchaseOrder: { select: { poNumber: true } },
      serviceRequest: { select: { serviceNumber: true } },
    },
  });

  return rows.map((row) => ({
    paymentNumber: row.paymentNumber,
    vendor: `${row.vendor.name} (${row.vendor.code})`,
    purchaseOrder: row.purchaseOrder?.poNumber || "",
    serviceRequest: row.serviceRequest?.serviceNumber || "",
    status: row.status,
    amount: Number(row.amount),
    paidAt: toRowDate(row.paidAt),
    createdAt: toRowDate(row.createdAt),
  }));
}

async function getFinanceReportRows(session: Session, searchParams: SearchParamsLike) {
  const report = await getFinanceReportData(session as never, {
    q: getStringParam(searchParams, "q"),
    invoiceStatus: toStatus(getStringParam(searchParams, "invoiceStatus"), Object.values(InvoiceStatus)),
    paymentStatus: toStatus(getStringParam(searchParams, "paymentStatus"), Object.values(PaymentStatus)),
    sourceType: getStringParam(searchParams, "sourceType") as never,
    dateFrom: getDateParam(searchParams, "dateFrom"),
    dateTo: getDateParam(searchParams, "dateTo"),
  });

  return [
    {
      metric: "Total Invoice Amount",
      value: report.summary.totalInvoiceAmount,
    },
    {
      metric: "Total Received Amount",
      value: report.summary.totalReceivedAmount,
    },
    {
      metric: "Outstanding Receivables",
      value: report.summary.outstandingReceivables,
    },
    {
      metric: "Total Vendor Payments",
      value: report.summary.totalVendorPayments,
    },
    {
      metric: "Net Cash Movement",
      value: report.summary.netCashMovement,
    },
    {
      metric: "Ledger Entries Count",
      value: report.summary.ledgerEntriesCount,
    },
  ];
}
