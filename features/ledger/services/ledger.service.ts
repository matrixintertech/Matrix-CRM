import { LedgerSourceType, Prisma, type PaymentStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { LedgerFilterInput } from "@/features/ledger/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

const countedPaymentStatuses: PaymentStatus[] = ["APPROVED", "PAID", "PARTIALLY_PAID"];

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
  const where: Prisma.LedgerEntryWhereInput = {
    ...scopeByTenant(session, {}),
  };

  if (input.sourceType) {
    where.sourceType = input.sourceType;
  }

  if (input.dateFrom || input.dateTo) {
    where.entryDate = {};
    if (input.dateFrom) {
      where.entryDate.gte = startOfDay(input.dateFrom);
    }
    if (input.dateTo) {
      where.entryDate.lte = endOfDay(input.dateTo);
    }
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
      { serviceRequest: { serviceNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [entries, total, aggregate] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
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
        vendorPayment: {
          select: {
            id: true,
            paymentNumber: true,
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
    }),
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.aggregate({
      where,
      _sum: {
        debitAmount: true,
        creditAmount: true,
      },
    }),
  ]);

  const totalDebit = roundMoney(Number(aggregate._sum.debitAmount ?? 0));
  const totalCredit = roundMoney(Number(aggregate._sum.creditAmount ?? 0));

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
      netAmount: roundMoney(totalDebit - totalCredit),
    },
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
