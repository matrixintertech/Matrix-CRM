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
