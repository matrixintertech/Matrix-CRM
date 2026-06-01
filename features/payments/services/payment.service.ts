import { InvoiceStatus, PaymentStatus, Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { CreatePaymentInput, UpdatePaymentInput, UpdatePaymentStatusInput } from "@/features/payments/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

const paymentStatusesCountedInPaidTotal: PaymentStatus[] = [
  PaymentStatus.APPROVED,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_PAID,
];

const invoiceStatusesAllowedForPaymentCapture = new Set<InvoiceStatus>([
  InvoiceStatus.APPROVED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
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

type DbLike = Prisma.TransactionClient | typeof prisma;

async function generatePaymentNumber(tx: DbLike, servicePartnerId: string) {
  const servicePartner = await tx.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `PAY-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await tx.payment.findFirst({
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

  throw new Error("Unable to generate a unique payment number.");
}

async function getInvoiceForPaymentScope(session: Session, invoiceId: string, tx: DbLike = prisma) {
  return tx.invoice.findFirst({
    where: {
      id: invoiceId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    select: {
      id: true,
      servicePartnerId: true,
      status: true,
      grandTotal: true,
      serviceRequestId: true,
    },
  });
}

async function getInvoicePaymentByIdForScope(session: Session, paymentId: string, tx: DbLike = prisma) {
  return tx.payment.findFirst({
    where: {
      id: paymentId,
      invoiceId: { not: null },
      ...scopeByTenant(session, {}),
    },
    select: {
      id: true,
      servicePartnerId: true,
      invoiceId: true,
      amount: true,
      status: true,
    },
  });
}

async function getPaidTotalForInvoice(tx: DbLike, invoiceId: string) {
  const aggregate = await tx.payment.aggregate({
    where: {
      invoiceId,
      status: {
        in: paymentStatusesCountedInPaidTotal,
      },
    },
    _sum: {
      amount: true,
    },
  });

  return roundMoney(Number(aggregate._sum.amount ?? 0));
}

function resolveInvoiceStatusFromPaidAmount(currentStatus: InvoiceStatus, grandTotal: number, paidAmount: number) {
  if (currentStatus === InvoiceStatus.CANCELLED || currentStatus === InvoiceStatus.REJECTED) {
    return currentStatus;
  }

  if (grandTotal <= 0) {
    return currentStatus;
  }

  if (paidAmount >= grandTotal) {
    return InvoiceStatus.PAID;
  }

  if (paidAmount > 0) {
    return InvoiceStatus.PARTIALLY_PAID;
  }

  if (currentStatus === InvoiceStatus.PAID || currentStatus === InvoiceStatus.PARTIALLY_PAID) {
    return InvoiceStatus.APPROVED;
  }

  return currentStatus;
}

async function syncInvoicePaymentStatus(tx: DbLike, invoiceId: string, servicePartnerId: string) {
  const invoice = await tx.invoice.findFirst({
    where: {
      id: invoiceId,
      servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      grandTotal: true,
    },
  });

  if (!invoice) {
    return null;
  }

  const grandTotal = roundMoney(Number(invoice.grandTotal));
  const paidAmount = await getPaidTotalForInvoice(tx, invoice.id);
  const nextStatus = resolveInvoiceStatusFromPaidAmount(invoice.status, grandTotal, paidAmount);

  if (nextStatus !== invoice.status) {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: nextStatus },
    });
  }

  return {
    grandTotal,
    paidAmount,
    balanceDue: roundMoney(Math.max(grandTotal - paidAmount, 0)),
    invoiceStatus: nextStatus,
  };
}

function assertInvoiceAcceptsPayments(status: InvoiceStatus) {
  if (!invoiceStatusesAllowedForPaymentCapture.has(status)) {
    throw new Error("Invoice status does not allow payment capture.");
  }
}

function isCountedPaymentStatus(status: PaymentStatus) {
  return paymentStatusesCountedInPaidTotal.includes(status);
}

export async function listPaymentsForInvoice(session: Session, invoiceId: string) {
  const invoice = await getInvoiceForPaymentScope(session, invoiceId);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const [payments, paidAmount] = await Promise.all([
    prisma.payment.findMany({
      where: {
        invoiceId: invoice.id,
        servicePartnerId: invoice.servicePartnerId,
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      include: {
        requestedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    }),
    getPaidTotalForInvoice(prisma, invoice.id),
  ]);

  const grandTotal = roundMoney(Number(invoice.grandTotal));
  const balanceDue = roundMoney(Math.max(grandTotal - paidAmount, 0));
  const paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" =
    paidAmount <= 0 ? "UNPAID" : balanceDue <= 0 ? "PAID" : "PARTIALLY_PAID";

  return {
    invoice: {
      id: invoice.id,
      servicePartnerId: invoice.servicePartnerId,
      status: invoice.status,
      grandTotal,
    },
    summary: {
      grandTotal,
      paidAmount,
      balanceDue,
      paymentStatus,
    },
    payments,
  };
}

export async function createInvoicePayment(session: Session, input: CreatePaymentInput) {
  const invoice = await getInvoiceForPaymentScope(session, input.invoiceId);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  assertInvoiceAcceptsPayments(invoice.status);
  const amount = roundMoney(input.amount);

  if (invoice.status === InvoiceStatus.PAID) {
    throw new Error("Invoice is already marked as paid.");
  }

  return prisma.$transaction(async (tx) => {
    const paidAmount = await getPaidTotalForInvoice(tx, invoice.id);
    const grandTotal = roundMoney(Number(invoice.grandTotal));
    const balanceDue = roundMoney(Math.max(grandTotal - paidAmount, 0));
    if (amount > balanceDue) {
      throw new Error("Payment amount exceeds the current balance due.");
    }

    const paymentNumber = await generatePaymentNumber(tx, invoice.servicePartnerId);
    const payment = await tx.payment.create({
      data: {
        servicePartnerId: invoice.servicePartnerId,
        invoiceId: invoice.id,
        serviceRequestId: invoice.serviceRequestId ?? null,
        paymentNumber,
        status: input.status,
        amount,
        approvedAmount: isCountedPaymentStatus(input.status) ? amount : null,
        currency: "INR",
        mode: input.mode,
        referenceNumber: normalizeOptionalString(input.referenceNumber),
        requestedByUserId: session.user.id,
        approvedByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidAt: isCountedPaymentStatus(input.status) ? input.paymentDate : null,
        remarks: normalizeOptionalString(input.notes),
      },
    });

    const sync = await syncInvoicePaymentStatus(tx, invoice.id, invoice.servicePartnerId);
    return {
      payment,
      sync,
    };
  });
}

export async function updateInvoicePayment(session: Session, paymentId: string, input: UpdatePaymentInput) {
  const existing = await getInvoicePaymentByIdForScope(session, paymentId);
  if (!existing || !existing.invoiceId) {
    throw new Error("Payment not found.");
  }

  const invoice = await getInvoiceForPaymentScope(session, existing.invoiceId);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  const amount = roundMoney(input.amount);
  return prisma.$transaction(async (tx) => {
    const sumOtherPayments = await tx.payment.aggregate({
      where: {
        invoiceId: invoice.id,
        id: { not: existing.id },
        status: { in: paymentStatusesCountedInPaidTotal },
      },
      _sum: {
        amount: true,
      },
    });
    const otherPaid = roundMoney(Number(sumOtherPayments._sum.amount ?? 0));
    const nextCountedAmount = isCountedPaymentStatus(input.status) ? amount : 0;
    const grandTotal = roundMoney(Number(invoice.grandTotal));
    if (roundMoney(otherPaid + nextCountedAmount) > grandTotal) {
      throw new Error("Payment amount exceeds the current balance due.");
    }

    const updated = await tx.payment.update({
      where: { id: existing.id },
      data: {
        amount,
        status: input.status,
        approvedAmount: isCountedPaymentStatus(input.status) ? amount : null,
        mode: input.mode,
        referenceNumber: normalizeOptionalString(input.referenceNumber),
        paidAt: isCountedPaymentStatus(input.status) ? input.paymentDate : null,
        remarks: normalizeOptionalString(input.notes),
        approvedByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
      },
    });

    const sync = await syncInvoicePaymentStatus(tx, invoice.id, invoice.servicePartnerId);
    return {
      payment: updated,
      sync,
      invoiceId: invoice.id,
    };
  });
}

export async function updateInvoicePaymentStatus(session: Session, paymentId: string, input: UpdatePaymentStatusInput) {
  const existing = await getInvoicePaymentByIdForScope(session, paymentId);
  if (!existing || !existing.invoiceId) {
    throw new Error("Payment not found.");
  }

  const invoice = await getInvoiceForPaymentScope(session, existing.invoiceId);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  return prisma.$transaction(async (tx) => {
    const sumOtherPayments = await tx.payment.aggregate({
      where: {
        invoiceId: invoice.id,
        id: { not: existing.id },
        status: { in: paymentStatusesCountedInPaidTotal },
      },
      _sum: {
        amount: true,
      },
    });
    const otherPaid = roundMoney(Number(sumOtherPayments._sum.amount ?? 0));
    const currentAmount = roundMoney(Number(existing.amount));
    const nextCountedAmount = isCountedPaymentStatus(input.status) ? currentAmount : 0;
    const grandTotal = roundMoney(Number(invoice.grandTotal));
    if (roundMoney(otherPaid + nextCountedAmount) > grandTotal) {
      throw new Error("Payment status update exceeds the current balance due.");
    }

    const updated = await tx.payment.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        approvedAmount: isCountedPaymentStatus(input.status) ? currentAmount : null,
        approvedByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidByUserId: isCountedPaymentStatus(input.status) ? session.user.id : null,
        paidAt: isCountedPaymentStatus(input.status) ? new Date() : null,
      },
    });

    const sync = await syncInvoicePaymentStatus(tx, invoice.id, invoice.servicePartnerId);
    return {
      payment: updated,
      sync,
      invoiceId: invoice.id,
    };
  });
}

export async function voidInvoicePayment(session: Session, paymentId: string) {
  const existing = await getInvoicePaymentByIdForScope(session, paymentId);
  if (!existing || !existing.invoiceId) {
    throw new Error("Payment not found.");
  }

  const invoice = await getInvoiceForPaymentScope(session, existing.invoiceId);
  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.update({
      where: { id: existing.id },
      data: {
        status: PaymentStatus.CANCELLED,
      },
    });
    const sync = await syncInvoicePaymentStatus(tx, invoice.id, invoice.servicePartnerId);
    return {
      payment,
      sync,
      invoiceId: invoice.id,
    };
  });
}
