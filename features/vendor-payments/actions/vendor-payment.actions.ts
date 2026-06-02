"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createVendorPaymentSchema,
  updateVendorPaymentSchema,
  updateVendorPaymentStatusSchema,
} from "@/features/vendor-payments/validations";
import {
  createVendorPayment,
  updateVendorPayment,
  updateVendorPaymentStatus,
  voidVendorPayment,
} from "@/features/vendor-payments/services/vendor-payment.service";
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

function revalidateVendorPaymentPaths(vendorPaymentId: string, purchaseOrderId?: string | null) {
  revalidatePath("/vendor-payments");
  revalidatePath(`/vendor-payments/${vendorPaymentId}`);
  if (purchaseOrderId) {
    revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  }
}

function isTenantMismatchError(error: unknown) {
  return error instanceof Error && (error.message.toLowerCase().includes("not found") || error.message.toLowerCase().includes("tenant") || error.message.toLowerCase().includes("mismatch") || error.message.toLowerCase().includes("invalid"));
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function logLedgerChanges(input: {
  action: "ledger.entry_create" | "ledger.entry_reverse";
  vendorPaymentId: string;
  servicePartnerId: string;
  purchaseOrderId?: string | null;
  entries?: Array<{ id: string; debitAmount: number; creditAmount: number }>;
}) {
  for (const entry of input.entries ?? []) {
    await logActivity({
      action: input.action,
      module: "ledger",
      entityType: "OTHER",
      entityId: entry.id,
      message: input.action === "ledger.entry_create" ? "Ledger entry created from vendor payment" : "Ledger reversal created from vendor payment",
      metadata: {
        vendorPaymentId: input.vendorPaymentId,
        purchaseOrderId: input.purchaseOrderId ?? null,
        debitAmount: entry.debitAmount,
        creditAmount: entry.creditAmount,
      },
      servicePartnerId: input.servicePartnerId,
    });
  }
}

export async function createVendorPaymentAction(formData: FormData) {
  const session = await requirePermission("vendor_payments.create");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/vendor-payments");
  const parsed = createVendorPaymentSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    vendorId: getFormString(formData, "vendorId"),
    purchaseOrderId: getFormString(formData, "purchaseOrderId"),
    amount: getFormString(formData, "amount"),
    paymentDate: getFormString(formData, "paymentDate"),
    notes: getFormString(formData, "notes"),
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "vendor-payment-validation"));
  }

  try {
    const result = await createVendorPayment(session, parsed.data);

    await logActivity({
      action: "vendor_payment.create",
      module: "vendor_payments",
      entityType: "VENDOR_PAYMENT",
      entityId: result.vendorPayment.id,
      message: "Vendor payment recorded",
      metadata: {
        paymentNumber: result.vendorPayment.paymentNumber,
        vendorId: result.vendorPayment.vendorId,
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        amount: result.vendorPayment.amount,
        status: result.vendorPayment.status,
      },
      servicePartnerId: result.vendorPayment.servicePartnerId,
    });

    if ((result.ledger?.createdEntries.length ?? 0) > 0) {
      await logLedgerChanges({
        action: "ledger.entry_create",
        vendorPaymentId: result.vendorPayment.id,
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        servicePartnerId: result.vendorPayment.servicePartnerId,
        entries: result.ledger.createdEntries,
      });
      await logActivity({
        action: "vendor_payment.ledger_posted",
        module: "vendor_payments",
        entityType: "VENDOR_PAYMENT",
        entityId: result.vendorPayment.id,
        message: "Ledger posting created for vendor payment",
        metadata: {
          purchaseOrderId: result.vendorPayment.purchaseOrderId,
          ledgerEntryCount: result.ledger.createdEntries.length,
        },
        servicePartnerId: result.vendorPayment.servicePartnerId,
      });
    }

    revalidateVendorPaymentPaths(result.vendorPayment.id, result.vendorPayment.purchaseOrderId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=vendor-payment-recorded`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(withErrorCode(redirectTo, "vendor-payment-duplicate"));
    }
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "vendor-payment-mismatch"));
    }
    throw error;
  }
}

export async function updateVendorPaymentAction(vendorPaymentId: string, formData: FormData) {
  const session = await requirePermission("vendor_payments.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/vendor-payments");
  const parsed = updateVendorPaymentSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    vendorId: getFormString(formData, "vendorId"),
    purchaseOrderId: getFormString(formData, "purchaseOrderId"),
    amount: getFormString(formData, "amount"),
    paymentDate: getFormString(formData, "paymentDate"),
    notes: getFormString(formData, "notes"),
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "vendor-payment-validation"));
  }

  try {
    const result = await updateVendorPayment(session, vendorPaymentId, parsed.data);

    await logActivity({
      action: "vendor_payment.update",
      module: "vendor_payments",
      entityType: "VENDOR_PAYMENT",
      entityId: result.vendorPayment.id,
      message: "Vendor payment updated",
      metadata: {
        vendorId: result.vendorPayment.vendorId,
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        amount: result.vendorPayment.amount,
        status: result.vendorPayment.status,
      },
      servicePartnerId: result.vendorPayment.servicePartnerId,
    });

    if ((result.ledger?.createdEntries.length ?? 0) > 0) {
      const hasReversal = result.ledger!.createdEntries.some((entry) => entry.creditAmount > 0);
      await logLedgerChanges({
        action: hasReversal ? "ledger.entry_reverse" : "ledger.entry_create",
        vendorPaymentId: result.vendorPayment.id,
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        servicePartnerId: result.vendorPayment.servicePartnerId,
        entries: result.ledger.createdEntries,
      });
      await logActivity({
        action: hasReversal ? "vendor_payment.ledger_reversed" : "vendor_payment.ledger_posted",
        module: "vendor_payments",
        entityType: "VENDOR_PAYMENT",
        entityId: result.vendorPayment.id,
        message: hasReversal ? "Ledger reversal created from vendor payment update" : "Ledger posting created from vendor payment update",
        metadata: {
          purchaseOrderId: result.vendorPayment.purchaseOrderId,
          ledgerEntryCount: result.ledger.createdEntries.length,
        },
        servicePartnerId: result.vendorPayment.servicePartnerId,
      });
    }

    revalidateVendorPaymentPaths(result.vendorPayment.id, result.vendorPayment.purchaseOrderId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=vendor-payment-updated`);
  } catch (error) {
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "vendor-payment-mismatch"));
    }
    throw error;
  }
}

export async function updateVendorPaymentStatusAction(vendorPaymentId: string, formData: FormData) {
  const session = await requirePermission("vendor_payments.status.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/vendor-payments");
  const parsed = updateVendorPaymentStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "vendor-payment-status-validation"));
  }

  try {
    const result = await updateVendorPaymentStatus(session, vendorPaymentId, parsed.data);
    await logActivity({
      action: "vendor_payment.status_change",
      module: "vendor_payments",
      entityType: "VENDOR_PAYMENT",
      entityId: result.vendorPayment.id,
      message: `Vendor payment status changed to ${result.vendorPayment.status}`,
      metadata: {
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        status: result.vendorPayment.status,
      },
      servicePartnerId: result.vendorPayment.servicePartnerId,
    });

    if ((result.ledger?.createdEntries.length ?? 0) > 0) {
      const hasReversal = result.ledger!.createdEntries.some((entry) => entry.creditAmount > 0);
      await logLedgerChanges({
        action: hasReversal ? "ledger.entry_reverse" : "ledger.entry_create",
        vendorPaymentId: result.vendorPayment.id,
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        servicePartnerId: result.vendorPayment.servicePartnerId,
        entries: result.ledger.createdEntries,
      });
      await logActivity({
        action: hasReversal ? "vendor_payment.ledger_reversed" : "vendor_payment.ledger_posted",
        module: "vendor_payments",
        entityType: "VENDOR_PAYMENT",
        entityId: result.vendorPayment.id,
        message: hasReversal ? "Ledger reversal created from vendor payment status update" : "Ledger posting created from vendor payment status update",
        metadata: {
          purchaseOrderId: result.vendorPayment.purchaseOrderId,
          ledgerEntryCount: result.ledger.createdEntries.length,
        },
        servicePartnerId: result.vendorPayment.servicePartnerId,
      });
    }

    revalidateVendorPaymentPaths(result.vendorPayment.id, result.vendorPayment.purchaseOrderId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=vendor-payment-status-updated`);
  } catch (error) {
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "vendor-payment-mismatch"));
    }
    throw error;
  }
}

export async function deleteVendorPaymentAction(vendorPaymentId: string, formData: FormData) {
  const session = await requirePermission("vendor_payments.delete");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/vendor-payments");

  try {
    const result = await voidVendorPayment(session, vendorPaymentId);
    await logActivity({
      action: "vendor_payment.delete",
      module: "vendor_payments",
      entityType: "VENDOR_PAYMENT",
      entityId: result.vendorPayment.id,
      message: "Vendor payment voided",
      metadata: {
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        status: result.vendorPayment.status,
      },
      servicePartnerId: result.vendorPayment.servicePartnerId,
    });

    if ((result.ledger?.createdEntries.length ?? 0) > 0) {
      await logLedgerChanges({
        action: "ledger.entry_reverse",
        vendorPaymentId: result.vendorPayment.id,
        purchaseOrderId: result.vendorPayment.purchaseOrderId,
        servicePartnerId: result.vendorPayment.servicePartnerId,
        entries: result.ledger.createdEntries,
      });
      await logActivity({
        action: "vendor_payment.ledger_reversed",
        module: "vendor_payments",
        entityType: "VENDOR_PAYMENT",
        entityId: result.vendorPayment.id,
        message: "Ledger reversal created from vendor payment void",
        metadata: {
          purchaseOrderId: result.vendorPayment.purchaseOrderId,
          ledgerEntryCount: result.ledger.createdEntries.length,
        },
        servicePartnerId: result.vendorPayment.servicePartnerId,
      });
    }

    revalidateVendorPaymentPaths(result.vendorPayment.id, result.vendorPayment.purchaseOrderId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=vendor-payment-deleted`);
  } catch (error) {
    if (isTenantMismatchError(error)) {
      redirect(withErrorCode(redirectTo, "vendor-payment-mismatch"));
    }
    throw error;
  }
}
