"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createPaymentSchema, updatePaymentSchema, updatePaymentStatusSchema } from "@/features/payments/validations";
import {
  createInvoicePayment,
  updateInvoicePayment,
  updateInvoicePaymentStatus,
  voidInvoicePayment,
} from "@/features/payments/services/payment.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

function revalidateInvoicePaymentPaths(invoiceId: string) {
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
}

function isOverpaymentError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("balance due");
}

function isTenantMismatchError(error: unknown) {
  return error instanceof Error && (error.message.toLowerCase().includes("not found") || error.message.toLowerCase().includes("tenant"));
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function logLedgerChanges(input: {
  action: "ledger.entry_create" | "ledger.entry_reverse";
  paymentId: string;
  servicePartnerId: string;
  invoiceId?: string | null;
  entries?: Array<{ id: string; debitAmount: number; creditAmount: number }>;
}) {
  for (const entry of input.entries ?? []) {
    await logActivity({
      action: input.action,
      module: "ledger",
      entityType: "OTHER",
      entityId: entry.id,
      message: input.action === "ledger.entry_create" ? "Ledger entry created from payment" : "Ledger reversal created from payment",
      metadata: {
        paymentId: input.paymentId,
        invoiceId: input.invoiceId ?? null,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
      },
      servicePartnerId: input.servicePartnerId,
    });
  }
}

export async function createPaymentAction(formData: FormData) {
  const session = await requirePermission("payments.create");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/invoices");
  const parsed = createPaymentSchema.safeParse({
    invoiceId: getFormString(formData, "invoiceId"),
    amount: getFormString(formData, "amount"),
    paymentDate: getFormString(formData, "paymentDate"),
    mode: getFormString(formData, "mode"),
    referenceNumber: getFormString(formData, "referenceNumber"),
    notes: getFormString(formData, "notes"),
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "payment-validation"));
  }

  try {
    const result = await createInvoicePayment(session, parsed.data);

    await logActivity({
      action: "payment.create",
      module: "payments",
      entityType: "PAYMENT",
      entityId: result.payment.id,
      message: "Invoice payment recorded",
      metadata: {
        paymentNumber: result.payment.paymentNumber,
        invoiceId: result.payment.invoiceId,
        amount: result.payment.amount,
        mode: result.payment.mode,
        status: result.payment.status,
      },
      servicePartnerId: result.payment.servicePartnerId,
    });

    if (result.payment.invoiceId) {
      if ((result.ledger?.createdEntries.length ?? 0) > 0) {
        await logLedgerChanges({
          action: "ledger.entry_create",
          paymentId: result.payment.id,
          invoiceId: result.payment.invoiceId,
          servicePartnerId: result.payment.servicePartnerId,
          entries: result.ledger?.createdEntries,
        });
        await logActivity({
          action: "payment.ledger_posted",
          module: "payments",
          entityType: "PAYMENT",
          entityId: result.payment.id,
          message: "Ledger posting created for payment",
          metadata: {
            invoiceId: result.payment.invoiceId,
            ledgerEntryCount: result.ledger?.createdEntries.length ?? 0,
          },
          servicePartnerId: result.payment.servicePartnerId,
        });
      }
      await logActivity({
        action: "invoice.payment_recorded",
        module: "invoices",
        entityType: "INVOICE",
        entityId: result.payment.invoiceId,
        message: "Invoice payment recorded",
        metadata: {
          paymentId: result.payment.id,
          paymentNumber: result.payment.paymentNumber,
          amount: result.payment.amount,
          status: result.payment.status,
        },
        servicePartnerId: result.payment.servicePartnerId,
      });
      revalidateInvoicePaymentPaths(result.payment.invoiceId);
    }

    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=payment-recorded`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(withErrorCode(redirectTo, "payment-duplicate"));
    }
    if (isOverpaymentError(error)) {
      redirect(withErrorCode(redirectTo, "payment-overpayment"));
    }
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "payment-mismatch"));
    }
    throw error;
  }
}

export async function updatePaymentAction(paymentId: string, formData: FormData) {
  const session = await requirePermission("payments.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/invoices");
  const parsed = updatePaymentSchema.safeParse({
    amount: getFormString(formData, "amount"),
    paymentDate: getFormString(formData, "paymentDate"),
    mode: getFormString(formData, "mode"),
    referenceNumber: getFormString(formData, "referenceNumber"),
    notes: getFormString(formData, "notes"),
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "payment-validation"));
  }

  try {
    const result = await updateInvoicePayment(session, paymentId, parsed.data);

    await logActivity({
      action: "payment.update",
      module: "payments",
      entityType: "PAYMENT",
      entityId: result.payment.id,
      message: "Invoice payment updated",
      metadata: {
        invoiceId: result.payment.invoiceId,
        amount: result.payment.amount,
        mode: result.payment.mode,
        status: result.payment.status,
      },
      servicePartnerId: result.payment.servicePartnerId,
    });

    if (result.payment.invoiceId) {
      if ((result.ledger?.createdEntries.length ?? 0) > 0) {
        const hasReversal = result.ledger!.createdEntries.some((entry) => entry.creditAmount > 0);
        await logLedgerChanges({
          action: hasReversal ? "ledger.entry_reverse" : "ledger.entry_create",
          paymentId: result.payment.id,
          invoiceId: result.payment.invoiceId,
          servicePartnerId: result.payment.servicePartnerId,
          entries: result.ledger?.createdEntries,
        });
        await logActivity({
          action: hasReversal ? "payment.ledger_reversed" : "payment.ledger_posted",
          module: "payments",
          entityType: "PAYMENT",
          entityId: result.payment.id,
          message: hasReversal ? "Ledger reversal created from payment update" : "Ledger posting created from payment update",
          metadata: {
            invoiceId: result.payment.invoiceId,
            ledgerEntryCount: result.ledger?.createdEntries.length ?? 0,
          },
          servicePartnerId: result.payment.servicePartnerId,
        });
      }
      await logActivity({
        action: "invoice.payment_updated",
        module: "invoices",
        entityType: "INVOICE",
        entityId: result.payment.invoiceId,
        message: "Invoice payment updated",
        metadata: {
          paymentId: result.payment.id,
          amount: result.payment.amount,
          status: result.payment.status,
        },
        servicePartnerId: result.payment.servicePartnerId,
      });
      revalidateInvoicePaymentPaths(result.payment.invoiceId);
    }

    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=payment-updated`);
  } catch (error) {
    if (isOverpaymentError(error)) {
      redirect(withErrorCode(redirectTo, "payment-overpayment"));
    }
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "payment-mismatch"));
    }
    throw error;
  }
}

export async function updatePaymentStatusAction(paymentId: string, formData: FormData) {
  const session = await requirePermission("payments.status.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/invoices");
  const parsed = updatePaymentStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "payment-status-validation"));
  }

  try {
    const result = await updateInvoicePaymentStatus(session, paymentId, parsed.data);
    await logActivity({
      action: "payment.status_change",
      module: "payments",
      entityType: "PAYMENT",
      entityId: result.payment.id,
      message: `Invoice payment status changed to ${result.payment.status}`,
      metadata: {
        invoiceId: result.payment.invoiceId,
        status: result.payment.status,
      },
      servicePartnerId: result.payment.servicePartnerId,
    });

    if (result.payment.invoiceId) {
      if ((result.ledger?.createdEntries.length ?? 0) > 0) {
        const hasReversal = result.ledger!.createdEntries.some((entry) => entry.creditAmount > 0);
        await logLedgerChanges({
          action: hasReversal ? "ledger.entry_reverse" : "ledger.entry_create",
          paymentId: result.payment.id,
          invoiceId: result.payment.invoiceId,
          servicePartnerId: result.payment.servicePartnerId,
          entries: result.ledger?.createdEntries,
        });
        await logActivity({
          action: hasReversal ? "payment.ledger_reversed" : "payment.ledger_posted",
          module: "payments",
          entityType: "PAYMENT",
          entityId: result.payment.id,
          message: hasReversal ? "Ledger reversal created from payment status update" : "Ledger posting created from payment status update",
          metadata: {
            invoiceId: result.payment.invoiceId,
            ledgerEntryCount: result.ledger?.createdEntries.length ?? 0,
          },
          servicePartnerId: result.payment.servicePartnerId,
        });
      }
      revalidateInvoicePaymentPaths(result.payment.invoiceId);
    }
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=payment-status-updated`);
  } catch (error) {
    if (isOverpaymentError(error)) {
      redirect(withErrorCode(redirectTo, "payment-overpayment"));
    }
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "payment-mismatch"));
    }
    throw error;
  }
}

export async function deletePaymentAction(paymentId: string, formData: FormData) {
  const session = await requirePermission("payments.delete");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/invoices");

  try {
    const result = await voidInvoicePayment(session, paymentId);
    await logActivity({
      action: "payment.delete",
      module: "payments",
      entityType: "PAYMENT",
      entityId: result.payment.id,
      message: "Invoice payment voided",
      metadata: {
        invoiceId: result.payment.invoiceId,
        status: result.payment.status,
      },
      servicePartnerId: result.payment.servicePartnerId,
    });

    if (result.payment.invoiceId) {
      if ((result.ledger?.createdEntries.length ?? 0) > 0) {
        await logLedgerChanges({
          action: "ledger.entry_reverse",
          paymentId: result.payment.id,
          invoiceId: result.payment.invoiceId,
          servicePartnerId: result.payment.servicePartnerId,
          entries: result.ledger?.createdEntries,
        });
        await logActivity({
          action: "payment.ledger_reversed",
          module: "payments",
          entityType: "PAYMENT",
          entityId: result.payment.id,
          message: "Ledger reversal created from payment void",
          metadata: {
            invoiceId: result.payment.invoiceId,
            ledgerEntryCount: result.ledger?.createdEntries.length ?? 0,
          },
          servicePartnerId: result.payment.servicePartnerId,
        });
      }
      revalidateInvoicePaymentPaths(result.payment.invoiceId);
    }
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=payment-deleted`);
  } catch (error) {
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "payment-mismatch"));
    }
    throw error;
  }
}
