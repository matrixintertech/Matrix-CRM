import { PaymentStatus, Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { FinanceReportFilterInput } from "@/features/finance-reports/validations";
import { hasPermission } from "@/lib/auth/permissions";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

const countedPaymentStatuses: PaymentStatus[] = [
  PaymentStatus.APPROVED,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_PAID,
];

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatPeriodKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatPeriodLabel(periodKey: string) {
  const [year, month] = periodKey.split("-");
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

async function assertCanReadFinanceReports(session: Session) {
  if (session.user.isSuperAdmin) {
    return;
  }

  const allowed = await hasPermission(session, "reports.read");
  if (!allowed) {
    throw new Error("Finance reports access denied.");
  }
}

function buildDateRange(dateFrom?: Date, dateTo?: Date): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) {
    return undefined;
  }

  const filter: Prisma.DateTimeFilter = {};
  if (dateFrom) {
    filter.gte = startOfDay(dateFrom);
  }
  if (dateTo) {
    filter.lte = endOfDay(dateTo);
  }
  return filter;
}

function buildInvoiceWhere(session: Session, input: FinanceReportFilterInput): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {
    ...scopeByTenant(session, {}),
    deletedAt: null,
  };

  if (input.invoiceStatus) {
    where.status = input.invoiceStatus;
  }

  const invoiceDate = buildDateRange(input.dateFrom, input.dateTo);
  if (invoiceDate) {
    where.invoiceDate = invoiceDate;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { vendorInvoiceNumber: { contains: q, mode: "insensitive" } },
      { invoiceNumber: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { vendor: { name: { contains: q, mode: "insensitive" } } },
      { vendor: { code: { contains: q, mode: "insensitive" } } },
      { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function buildInvoicePaymentWhere(session: Session, input: FinanceReportFilterInput): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {
    ...scopeByTenant(session, {}),
    invoiceId: { not: null },
  };

  if (input.paymentStatus) {
    where.status = input.paymentStatus;
  }

  const paidAt = buildDateRange(input.dateFrom, input.dateTo);
  if (paidAt) {
    where.paidAt = paidAt;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { paymentNumber: { contains: q, mode: "insensitive" } },
      { referenceNumber: { contains: q, mode: "insensitive" } },
      { remarks: { contains: q, mode: "insensitive" } },
      { invoice: { vendorInvoiceNumber: { contains: q, mode: "insensitive" } } },
      { invoice: { invoiceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function buildVendorPaymentWhere(session: Session, input: FinanceReportFilterInput): Prisma.VendorPaymentWhereInput {
  const where: Prisma.VendorPaymentWhereInput = {
    ...scopeByTenant(session, {}),
  };

  if (input.paymentStatus) {
    where.status = input.paymentStatus;
  }

  const paidAt = buildDateRange(input.dateFrom, input.dateTo);
  if (paidAt) {
    where.paidAt = paidAt;
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

  return where;
}

function buildLedgerWhere(session: Session, input: FinanceReportFilterInput): Prisma.LedgerEntryWhereInput {
  const where: Prisma.LedgerEntryWhereInput = {
    ...scopeByTenant(session, {}),
  };

  if (input.sourceType) {
    where.sourceType = input.sourceType;
  }

  const entryDate = buildDateRange(input.dateFrom, input.dateTo);
  if (entryDate) {
    where.entryDate = entryDate;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { description: { contains: q, mode: "insensitive" } },
      { payment: { paymentNumber: { contains: q, mode: "insensitive" } } },
      { payment: { invoice: { vendorInvoiceNumber: { contains: q, mode: "insensitive" } } } },
      { payment: { invoice: { invoiceNumber: { contains: q, mode: "insensitive" } } } },
      { vendorPayment: { paymentNumber: { contains: q, mode: "insensitive" } } },
      { vendorPayment: { vendor: { name: { contains: q, mode: "insensitive" } } } },
      { vendorPayment: { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } } },
    ];
  }

  return where;
}

function resolveCountedStatusFilter(status?: PaymentStatus) {
  if (!status) {
    return countedPaymentStatuses;
  }
  return countedPaymentStatuses.includes(status) ? [status] : [];
}

export async function getFinanceReportData(session: Session, input: FinanceReportFilterInput) {
  await assertCanReadFinanceReports(session);

  const invoiceWhere = buildInvoiceWhere(session, input);
  const paymentWhere = buildInvoicePaymentWhere(session, input);
  const vendorPaymentWhere = buildVendorPaymentWhere(session, input);
  const ledgerWhere = buildLedgerWhere(session, input);

  const countedInvoiceStatuses = resolveCountedStatusFilter(input.paymentStatus);
  const countedVendorStatuses = resolveCountedStatusFilter(input.paymentStatus);

  const [
    invoices,
    invoicePaymentsForCash,
    vendorPaymentsForCash,
    ledgerAggregate,
    ledgerSourceCounts,
    ledgerEntriesCount,
  ] = await Promise.all([
    prisma.invoice.findMany({
      where: invoiceWhere,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        servicePartnerId: true,
        vendorInvoiceNumber: true,
        invoiceNumber: true,
        status: true,
        invoiceDate: true,
        receivedDate: true,
        dueDate: true,
        grandTotal: true,
        vendor: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        ...paymentWhere,
        ...(countedInvoiceStatuses.length > 0 ? { status: { in: countedInvoiceStatuses } } : { id: "__no-match__" }),
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        invoiceId: true,
        paymentNumber: true,
        amount: true,
        status: true,
        paidAt: true,
        invoice: {
          select: {
            id: true,
            vendorInvoiceNumber: true,
            invoiceNumber: true,
            vendor: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
            purchaseOrder: {
              select: {
                id: true,
                poNumber: true,
              },
            },
          },
        },
      },
    }),
    prisma.vendorPayment.findMany({
      where: {
        ...vendorPaymentWhere,
        ...(countedVendorStatuses.length > 0 ? { status: { in: countedVendorStatuses } } : { id: "__no-match__" }),
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        paymentNumber: true,
        amount: true,
        status: true,
        paidAt: true,
        vendor: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        purchaseOrder: {
          select: {
            id: true,
            poNumber: true,
          },
        },
      },
    }),
    prisma.ledgerEntry.aggregate({
      where: ledgerWhere,
      _sum: {
        debitAmount: true,
        creditAmount: true,
      },
    }),
    prisma.ledgerEntry.groupBy({
      by: ["sourceType"],
      where: ledgerWhere,
      _count: {
        _all: true,
      },
      _sum: {
        debitAmount: true,
        creditAmount: true,
      },
    }),
    prisma.ledgerEntry.count({
      where: ledgerWhere,
    }),
  ]);

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const invoicePaidGroups =
    invoiceIds.length > 0
      ? await prisma.payment.groupBy({
          by: ["invoiceId"],
          where: {
            invoiceId: { in: invoiceIds },
            status: { in: countedPaymentStatuses },
          },
          _sum: {
            amount: true,
          },
        })
      : [];

  const paidAmountByInvoiceId = new Map(
    invoicePaidGroups
      .filter((group): group is typeof group & { invoiceId: string } => Boolean(group.invoiceId))
      .map((group) => [group.invoiceId, roundMoney(Number(group._sum.amount ?? 0))])
  );

  const payables = invoices.map((invoice) => {
    const grandTotal = roundMoney(Number(invoice.grandTotal));
    const paidAmount = paidAmountByInvoiceId.get(invoice.id) ?? 0;
    const balanceDue = roundMoney(Math.max(grandTotal - paidAmount, 0));

    return {
      id: invoice.id,
      vendorInvoiceNumber: invoice.vendorInvoiceNumber,
      invoiceNumber: invoice.invoiceNumber,
      vendor: invoice.vendor,
      purchaseOrder: invoice.purchaseOrder,
      status: invoice.status,
      invoiceDate: invoice.invoiceDate,
      receivedDate: invoice.receivedDate,
      dueDate: invoice.dueDate,
      grandTotal,
      paidAmount,
      balanceDue,
    };
  });

  const totalVendorInvoiceAmount = roundMoney(payables.reduce((sum, row) => sum + row.grandTotal, 0));
  const outstandingPayables = roundMoney(payables.reduce((sum, row) => sum + row.balanceDue, 0));
  const totalInvoicePaymentsMade = roundMoney(invoicePaymentsForCash.reduce((sum, row) => sum + Number(row.amount), 0));
  const totalStandaloneVendorPayments = roundMoney(vendorPaymentsForCash.reduce((sum, row) => sum + Number(row.amount), 0));
  const totalOutgoingPayments = roundMoney(totalInvoicePaymentsMade + totalStandaloneVendorPayments);

  const paymentsMade = [
    ...invoicePaymentsForCash
      .filter((payment) => payment.invoice)
      .map((payment) => ({
        id: payment.id,
        paymentNumber: payment.paymentNumber,
        amount: roundMoney(Number(payment.amount)),
        status: payment.status,
        paidAt: payment.paidAt,
        sourceLabel: "Vendor Invoice Payment",
        vendor: payment.invoice!.vendor,
        purchaseOrder: payment.invoice!.purchaseOrder,
        vendorInvoiceNumber: payment.invoice!.vendorInvoiceNumber,
        invoiceNumber: payment.invoice!.invoiceNumber,
      })),
    ...vendorPaymentsForCash.map((vendorPayment) => ({
      id: vendorPayment.id,
      paymentNumber: vendorPayment.paymentNumber,
      amount: roundMoney(Number(vendorPayment.amount)),
      status: vendorPayment.status,
      paidAt: vendorPayment.paidAt,
      sourceLabel: "Vendor Payment",
      vendor: vendorPayment.vendor,
      purchaseOrder: vendorPayment.purchaseOrder,
      vendorInvoiceNumber: null,
      invoiceNumber: null,
    })),
  ].sort((left, right) => {
    const leftTime = left.paidAt?.getTime() ?? 0;
    const rightTime = right.paidAt?.getTime() ?? 0;
    return rightTime - leftTime;
  });

  const cashMovementMap = new Map<string, { incoming: number; outgoing: number }>();
  for (const payment of invoicePaymentsForCash) {
    if (!payment.paidAt) {
      continue;
    }
    const periodKey = formatPeriodKey(payment.paidAt);
    const current = cashMovementMap.get(periodKey) ?? { incoming: 0, outgoing: 0 };
    current.outgoing = roundMoney(current.outgoing + Number(payment.amount));
    cashMovementMap.set(periodKey, current);
  }
  for (const vendorPayment of vendorPaymentsForCash) {
    if (!vendorPayment.paidAt) {
      continue;
    }
    const periodKey = formatPeriodKey(vendorPayment.paidAt);
    const current = cashMovementMap.get(periodKey) ?? { incoming: 0, outgoing: 0 };
    current.outgoing = roundMoney(current.outgoing + Number(vendorPayment.amount));
    cashMovementMap.set(periodKey, current);
  }

  const cashMovement = [...cashMovementMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, values]) => ({
      period,
      label: formatPeriodLabel(period),
      incoming: roundMoney(values.incoming),
      outgoing: roundMoney(values.outgoing),
      net: roundMoney(values.incoming - values.outgoing),
    }));

  const totalDebit = roundMoney(Number(ledgerAggregate._sum.debitAmount ?? 0));
  const totalCredit = roundMoney(Number(ledgerAggregate._sum.creditAmount ?? 0));
  const ledgerSummary = {
    entriesCount: ledgerEntriesCount,
    totalDebit,
    totalCredit,
    netAmount: roundMoney(totalDebit - totalCredit),
    sourceTypeCounts: ledgerSourceCounts.map((row) => ({
      sourceType: row.sourceType,
      count: row._count._all,
      totalDebit: roundMoney(Number(row._sum.debitAmount ?? 0)),
      totalCredit: roundMoney(Number(row._sum.creditAmount ?? 0)),
      netAmount: roundMoney(Number(row._sum.debitAmount ?? 0) - Number(row._sum.creditAmount ?? 0)),
    })),
  };

  return {
    summary: {
      totalVendorInvoiceAmount,
      totalInvoicePaymentsMade,
      outstandingPayables,
      totalStandaloneVendorPayments,
      totalOutgoingPayments,
      ledgerEntriesCount,
    },
    payables,
    paymentsMade,
    cashMovement,
    ledgerSummary,
  };
}
