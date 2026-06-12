import { LedgerSourceType, Prisma, type ExpenseStatus, type PaymentStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { LedgerFilterInput } from "@/features/ledger/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

const countedPaymentStatuses: PaymentStatus[] = ["APPROVED", "PAID", "PARTIALLY_PAID"];
const completedExpenseStatuses: ExpenseStatus[] = ["APPROVED", "PAID"];

export type LedgerAccountGroup = "receivables" | "payables" | "expenses" | "inventory";
export type LedgerEntryDirection = "debit" | "credit";
export type LedgerStatusFilter = "completed" | "pending";
export type LedgerDateRange = "today" | "this_week" | "this_month" | "overdue";

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

type DbLike = Prisma.TransactionClient | typeof prisma;

function applyLedgerDateRange(where: Prisma.LedgerEntryWhereInput, dateRange?: LedgerDateRange) {
  if (!dateRange) {
    return;
  }

  const now = new Date();
  const from = startOfDay(now);
  let to: Date | undefined;

  if (dateRange === "today") {
    to = endOfDay(now);
  } else if (dateRange === "this_week") {
    to = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  } else if (dateRange === "this_month") {
    to = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  } else if (dateRange === "overdue") {
    where.entryDate = {
      lt: now,
    };
    return;
  }

  where.entryDate = {
    gte: from,
    ...(to ? { lte: to } : {}),
  };
}

function applyLedgerStatusFilter(where: Prisma.LedgerEntryWhereInput, status?: LedgerStatusFilter) {
  if (!status) {
    return;
  }

  if (status === "completed") {
    where.OR = [
      {
        payment: {
          status: {
            in: countedPaymentStatuses,
          },
        },
      },
      {
        vendorPayment: {
          status: {
            in: countedPaymentStatuses,
          },
        },
      },
      {
        expense: {
          status: {
            in: completedExpenseStatuses,
          },
        },
      },
      {
        inventoryTransaction: {
          id: {
            not: undefined,
          },
        },
      },
    ];
    return;
  }

  where.OR = [
    {
      payment: {
        status: {
          notIn: countedPaymentStatuses,
        },
      },
    },
    {
      vendorPayment: {
        status: {
          notIn: countedPaymentStatuses,
        },
      },
    },
    {
      expense: {
        status: {
          notIn: completedExpenseStatuses,
        },
      },
    },
  ];
}

function mapAccountGroupToSourceType(accountGroup?: LedgerAccountGroup) {
  if (accountGroup === "receivables") {
    return LedgerSourceType.PAYMENT;
  }
  if (accountGroup === "payables") {
    return LedgerSourceType.VENDOR_PAYMENT;
  }
  if (accountGroup === "expenses") {
    return LedgerSourceType.EXPENSE;
  }
  if (accountGroup === "inventory") {
    return LedgerSourceType.INVENTORY;
  }
  return undefined;
}

function buildLedgerWhere(session: Session, input: LedgerFilterInput): Prisma.LedgerEntryWhereInput {
  const where: Prisma.LedgerEntryWhereInput = {
    ...scopeByTenant(session, {}),
  };

  const sourceType = input.sourceType ?? mapAccountGroupToSourceType(input.accountGroup as LedgerAccountGroup | undefined);
  if (sourceType) {
    where.sourceType = sourceType;
  }

  if (input.entryType === "debit") {
    where.debitAmount = {
      gt: 0,
    };
  }
  if (input.entryType === "credit") {
    where.creditAmount = {
      gt: 0,
    };
  }

  if (input.dateFrom || input.dateTo) {
    where.entryDate = {};
    if (input.dateFrom) {
      where.entryDate.gte = startOfDay(input.dateFrom);
    }
    if (input.dateTo) {
      where.entryDate.lte = endOfDay(input.dateTo);
    }
  } else {
    applyLedgerDateRange(where, input.dateRange as LedgerDateRange | undefined);
  }

  applyLedgerStatusFilter(where, input.status as LedgerStatusFilter | undefined);

  if (input.q?.trim()) {
    const q = input.q.trim();
    const queryFilters: Prisma.LedgerEntryWhereInput[] = [
      { description: { contains: q, mode: "insensitive" } },
      { payment: { paymentNumber: { contains: q, mode: "insensitive" } } },
      { payment: { invoice: { vendorInvoiceNumber: { contains: q, mode: "insensitive" } } } },
      { payment: { invoice: { invoiceNumber: { contains: q, mode: "insensitive" } } } },
      { payment: { client: { name: { contains: q, mode: "insensitive" } } } },
      { vendorPayment: { paymentNumber: { contains: q, mode: "insensitive" } } },
      { vendorPayment: { vendor: { name: { contains: q, mode: "insensitive" } } } },
      { vendorPayment: { purchaseOrder: { poNumber: { contains: q, mode: "insensitive" } } } },
      { expense: { expenseNumber: { contains: q, mode: "insensitive" } } },
      { expense: { vendor: { name: { contains: q, mode: "insensitive" } } } },
      { inventoryTransaction: { referenceNo: { contains: q, mode: "insensitive" } } },
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
    ];

    if (where.OR) {
      where.AND = [
        { OR: where.OR as Prisma.LedgerEntryWhereInput[] },
        { OR: queryFilters },
      ];
      delete where.OR;
    } else {
      where.OR = queryFilters;
    }
  }

  return where;
}

export async function syncLedgerForInvoicePayment(
  tx: DbLike,
  input: {
    paymentId: string;
    actorUserId?: string | null;
  }
) {
  const payment = await tx.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true,
      servicePartnerId: true,
      serviceRequestId: true,
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
        },
      },
    },
  });

  if (!payment?.invoiceId || !payment.invoice) {
    return { createdEntries: [] as Array<{ id: string; debitAmount: number; creditAmount: number }>, desiredNet: 0, currentNet: 0 };
  }

  const existingEntries = await tx.ledgerEntry.findMany({
    where: {
      servicePartnerId: payment.servicePartnerId,
      paymentId: payment.id,
      sourceType: LedgerSourceType.PAYMENT,
    },
    select: {
      id: true,
      debitAmount: true,
      creditAmount: true,
    },
  });

  const currentNet = roundMoney(
    existingEntries.reduce((sum, entry) => sum + Number(entry.debitAmount) - Number(entry.creditAmount), 0)
  );
  const desiredNet = countedPaymentStatuses.includes(payment.status) ? roundMoney(Number(payment.amount)) : 0;
  const delta = roundMoney(desiredNet - currentNet);

  if (delta === 0) {
    return { createdEntries: [] as Array<{ id: string; debitAmount: number; creditAmount: number }>, desiredNet, currentNet };
  }

  const createdEntry = await tx.ledgerEntry.create({
    data: {
      servicePartnerId: payment.servicePartnerId,
      serviceRequestId: payment.serviceRequestId ?? null,
      sourceType: LedgerSourceType.PAYMENT,
      paymentId: payment.id,
      entryDate: payment.paidAt ?? new Date(),
      debitAmount: delta > 0 ? Math.abs(delta) : 0,
      creditAmount: delta < 0 ? Math.abs(delta) : 0,
      description:
        delta > 0
          ? `Vendor invoice payment made for ${payment.invoice.vendorInvoiceNumber || payment.invoice.invoiceNumber} via ${payment.paymentNumber}`
          : `Vendor invoice payment reversal for ${payment.invoice.vendorInvoiceNumber || payment.invoice.invoiceNumber} via ${payment.paymentNumber}`,
      createdByUserId: input.actorUserId ?? null,
    },
    select: {
      id: true,
      debitAmount: true,
      creditAmount: true,
    },
  });

  return {
    createdEntries: [
      {
        id: createdEntry.id,
        debitAmount: Number(createdEntry.debitAmount),
        creditAmount: Number(createdEntry.creditAmount),
      },
    ],
    desiredNet,
    currentNet,
  };
}

export async function syncLedgerForVendorPayment(
  tx: DbLike,
  input: {
    vendorPaymentId: string;
    actorUserId?: string | null;
  }
) {
  const vendorPayment = await tx.vendorPayment.findUnique({
    where: { id: input.vendorPaymentId },
    select: {
      id: true,
      servicePartnerId: true,
      serviceRequestId: true,
      purchaseOrderId: true,
      paymentNumber: true,
      amount: true,
      status: true,
      paidAt: true,
      vendor: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      purchaseOrder: {
        select: {
          id: true,
          poNumber: true,
        },
      },
    },
  });

  if (!vendorPayment?.vendor) {
    return { createdEntries: [] as Array<{ id: string; debitAmount: number; creditAmount: number }>, desiredNet: 0, currentNet: 0 };
  }

  const existingEntries = await tx.ledgerEntry.findMany({
    where: {
      servicePartnerId: vendorPayment.servicePartnerId,
      vendorPaymentId: vendorPayment.id,
      sourceType: LedgerSourceType.VENDOR_PAYMENT,
    },
    select: {
      id: true,
      debitAmount: true,
      creditAmount: true,
    },
  });

  const currentNet = roundMoney(
    existingEntries.reduce((sum, entry) => sum + Number(entry.debitAmount) - Number(entry.creditAmount), 0)
  );
  const desiredNet = countedPaymentStatuses.includes(vendorPayment.status) ? roundMoney(Number(vendorPayment.amount)) : 0;
  const delta = roundMoney(desiredNet - currentNet);

  if (delta === 0) {
    return { createdEntries: [] as Array<{ id: string; debitAmount: number; creditAmount: number }>, desiredNet, currentNet };
  }

  const targetLabel = vendorPayment.purchaseOrder?.poNumber
    ? `${vendorPayment.vendor.name} against ${vendorPayment.purchaseOrder.poNumber}`
    : vendorPayment.vendor.name;

  const createdEntry = await tx.ledgerEntry.create({
    data: {
      servicePartnerId: vendorPayment.servicePartnerId,
      serviceRequestId: vendorPayment.serviceRequestId ?? null,
      sourceType: LedgerSourceType.VENDOR_PAYMENT,
      vendorPaymentId: vendorPayment.id,
      entryDate: vendorPayment.paidAt ?? new Date(),
      debitAmount: delta > 0 ? Math.abs(delta) : 0,
      creditAmount: delta < 0 ? Math.abs(delta) : 0,
      description:
        delta > 0
          ? `Vendor payment posted for ${targetLabel} via ${vendorPayment.paymentNumber}`
          : `Vendor payment ledger reversal for ${targetLabel} via ${vendorPayment.paymentNumber}`,
      createdByUserId: input.actorUserId ?? null,
    },
    select: {
      id: true,
      debitAmount: true,
      creditAmount: true,
    },
  });

  return {
    createdEntries: [
      {
        id: createdEntry.id,
        debitAmount: Number(createdEntry.debitAmount),
        creditAmount: Number(createdEntry.creditAmount),
      },
    ],
    desiredNet,
    currentNet,
  };
}

export async function listLedgerEntries(session: Session, input: LedgerFilterInput) {
  const pagination = getPagination(input);
  const where = buildLedgerWhere(session, input);

  const allEntries = await prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      include: {
        payment: {
          select: {
            id: true,
            paymentNumber: true,
            status: true,
            mode: true,
            referenceNumber: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
            invoiceId: true,
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                vendorInvoiceNumber: true,
              },
            },
          },
        },
        vendorPayment: {
          select: {
            id: true,
            paymentNumber: true,
            status: true,
            vendor: {
              select: {
                id: true,
                name: true,
                code: true,
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
        expense: {
          select: {
            id: true,
            expenseNumber: true,
            status: true,
            vendor: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        inventoryTransaction: {
          select: {
            id: true,
            referenceNo: true,
            vendor: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        serviceRequest: {
          select: {
            id: true,
            serviceNumber: true,
            title: true,
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
      },
    });

  const total = allEntries.length;
  const totalDebit = roundMoney(allEntries.reduce((sum, entry) => sum + Number(entry.debitAmount), 0));
  const totalCredit = roundMoney(allEntries.reduce((sum, entry) => sum + Number(entry.creditAmount), 0));
  let runningBalance = roundMoney(totalCredit - totalDebit);
  const runningBalanceMap = new Map<string, number>();

  for (const entry of allEntries) {
    runningBalanceMap.set(entry.id, runningBalance);
    runningBalance = roundMoney(runningBalance - (Number(entry.creditAmount) - Number(entry.debitAmount)));
  }

  const entries = allEntries.slice(pagination.skip, pagination.skip + pagination.take).map((entry) => ({
    ...entry,
    runningBalance: runningBalanceMap.get(entry.id) ?? 0,
  }));

  return {
    entries,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
    summary: {
      entriesCount: total,
      totalDebit,
      totalCredit,
      netAmount: roundMoney(totalCredit - totalDebit),
    },
  };
}

export async function getLedgerOverview(session: Session, input: LedgerFilterInput) {
  const result = await listLedgerEntries(session, { ...input, page: 1, pageSize: 5000 });

  const accountMap = new Map<
    LedgerAccountGroup,
    {
      label: string;
      amount: number;
      color: string;
    }
  >([
    ["receivables", { label: "Accounts Receivable", amount: 0, color: "#315cff" }],
    ["payables", { label: "Accounts Payable", amount: 0, color: "#8d5bff" }],
    ["expenses", { label: "Expenses", amount: 0, color: "#ff9a1a" }],
    ["inventory", { label: "Inventory", amount: 0, color: "#21c16b" }],
  ]);

  const recentTransactions = result.entries.slice(0, 5).map((entry) => {
    const net = Number(entry.creditAmount) - Number(entry.debitAmount);
    return {
      id: entry.id,
      description: entry.description?.trim() || "Ledger transaction",
      entryDate: entry.entryDate,
      amount: net,
    };
  });

  for (const entry of result.entries) {
    const net = Number(entry.creditAmount) - Number(entry.debitAmount);
    if (entry.sourceType === LedgerSourceType.PAYMENT) {
      accountMap.get("receivables")!.amount = roundMoney(accountMap.get("receivables")!.amount + net);
    } else if (entry.sourceType === LedgerSourceType.VENDOR_PAYMENT) {
      accountMap.get("payables")!.amount = roundMoney(accountMap.get("payables")!.amount + Math.abs(net));
    } else if (entry.sourceType === LedgerSourceType.EXPENSE) {
      accountMap.get("expenses")!.amount = roundMoney(accountMap.get("expenses")!.amount + Math.abs(net));
    } else if (entry.sourceType === LedgerSourceType.INVENTORY) {
      accountMap.get("inventory")!.amount = roundMoney(accountMap.get("inventory")!.amount + Math.abs(net));
    }
  }

  const accountSummary = Array.from(accountMap.entries()).map(([key, value]) => ({
    key,
    ...value,
  }));

  return {
    totalBalance: result.summary.netAmount,
    totalDebit: result.summary.totalDebit,
    totalCredit: result.summary.totalCredit,
    netBalance: result.summary.netAmount,
    transactionCount: result.summary.entriesCount,
    accountSummary,
    topAccounts: [...accountSummary].sort((left, right) => right.amount - left.amount),
    recentTransactions,
  };
}

export async function listLedgerEntriesForInvoice(session: Session, invoiceId: string, take = 10) {
  return prisma.ledgerEntry.findMany({
    where: {
      ...scopeByTenant(session, {}),
      payment: {
        invoiceId,
      },
    },
    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
    take,
    include: {
      payment: {
        select: {
          id: true,
          paymentNumber: true,
          invoiceId: true,
            invoice: {
              select: {
                id: true,
                invoiceNumber: true,
                vendorInvoiceNumber: true,
              },
            },
        },
      },
    },
  });
}
