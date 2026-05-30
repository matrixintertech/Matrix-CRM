"use server";

import { ApprovalStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { quotationStatusSchema, quotationUpsertSchema } from "@/features/quotations/validations";
import {
  createQuotation,
  getQuotationById,
  softDeleteQuotation,
  submitQuotation,
  updateQuotation,
  updateQuotationStatus,
} from "@/features/quotations/services/quotation.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseLinesJson(formData: FormData) {
  const raw = getFormString(formData, "linesJson");
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }
}

function parseQuotationInput(formData: FormData) {
  return quotationUpsertSchema.safeParse({
    serviceRequestId: getFormString(formData, "serviceRequestId"),
    validUntil: getFormString(formData, "validUntil"),
    notes: getFormString(formData, "notes"),
    lines: parseLinesJson(formData),
  });
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

function revalidateQuotationPaths(serviceRequestId: string) {
  revalidatePath("/service-requests");
  revalidatePath(`/service-requests/${serviceRequestId}`);
}

function asLineKey(line: {
  itemId: string;
  description: string | null;
  quantity: number;
  unitRate: number;
  taxPercent: number | null;
  amount: number;
}) {
  return `${line.itemId}:${line.description ?? ""}:${line.quantity}:${line.unitRate}:${line.taxPercent ?? ""}:${line.amount}`;
}

export async function createQuotationAction(formData: FormData) {
  const session = await requirePermission("quotations.create");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");
  const parsed = parseQuotationInput(formData);

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "quotation-validation"));
  }

  try {
    const created = await createQuotation(session, parsed.data);
    await logActivity({
      action: "quotation.create",
      module: "quotations",
      entityType: "QUOTATION",
      entityId: created.id,
      message: "Quotation created",
      metadata: {
        quotationNumber: created.quotationNumber,
        serviceRequestId: created.serviceRequestId,
        status: created.status,
      },
      servicePartnerId: created.servicePartnerId,
    });

    for (const line of parsed.data.lines) {
      await logActivity({
        action: "quotation.line_add",
        module: "quotations",
        entityType: "QUOTATION",
        entityId: created.id,
        message: "Quotation line added",
        metadata: {
          itemId: line.itemId,
          quantity: line.quantity,
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? null,
        },
        servicePartnerId: created.servicePartnerId,
      });
    }

    revalidateQuotationPaths(created.serviceRequestId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=quotation-created`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("already exists")) {
        redirect(withErrorCode(redirectTo, "quotation-duplicate"));
      }
      if (lower.includes("mismatch") || lower.includes("invalid")) {
        redirect(withErrorCode(redirectTo, "quotation-mismatch"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "quotation-not-found"));
      }
    }
    throw error;
  }
}

export async function updateQuotationAction(quotationId: string, formData: FormData) {
  const session = await requirePermission("quotations.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");
  const parsed = parseQuotationInput(formData);

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "quotation-validation"));
  }

  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    redirect(withErrorCode(redirectTo, "quotation-not-found"));
  }

  try {
    const updated = await updateQuotation(session, quotationId, parsed.data);

    await logActivity({
      action: "quotation.update",
      module: "quotations",
      entityType: "QUOTATION",
      entityId: updated.id,
      message: "Quotation updated",
      metadata: {
        status: updated.status,
        lineCount: parsed.data.lines.length,
      },
      servicePartnerId: updated.servicePartnerId,
    });

    const beforeLines = new Map(
      existing.items.map((line) => [
        line.itemId,
        {
          itemId: line.itemId,
          description: line.description,
          quantity: Number(line.quantity),
          unitRate: Number(line.unitRate),
          taxPercent: line.taxPercent === null ? null : Number(line.taxPercent),
          amount: Number(line.amount),
        },
      ])
    );
    const afterLines = new Map(
      parsed.data.lines.map((line) => [
        line.itemId,
        {
          itemId: line.itemId,
          description: line.description ?? null,
          quantity: line.quantity,
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? null,
          amount:
            Math.round(
              (line.quantity * line.unitRate + ((line.taxPercent ?? 0) * line.quantity * line.unitRate) / 100 + Number.EPSILON) * 100
            ) / 100,
        },
      ])
    );

    for (const [itemId, line] of afterLines.entries()) {
      const before = beforeLines.get(itemId);
      if (!before) {
        await logActivity({
          action: "quotation.line_add",
          module: "quotations",
          entityType: "QUOTATION",
          entityId: updated.id,
          message: "Quotation line added",
          metadata: line,
          servicePartnerId: updated.servicePartnerId,
        });
        continue;
      }

      if (asLineKey(before) !== asLineKey(line)) {
        await logActivity({
          action: "quotation.line_update",
          module: "quotations",
          entityType: "QUOTATION",
          entityId: updated.id,
          message: "Quotation line updated",
          metadata: {
            itemId,
            previous: before,
            next: line,
          },
          servicePartnerId: updated.servicePartnerId,
        });
      }
    }

    for (const [itemId, line] of beforeLines.entries()) {
      if (afterLines.has(itemId)) {
        continue;
      }
      await logActivity({
        action: "quotation.line_delete",
        module: "quotations",
        entityType: "QUOTATION",
        entityId: updated.id,
        message: "Quotation line deleted",
        metadata: {
          itemId,
          line,
        },
        servicePartnerId: updated.servicePartnerId,
      });
    }

    revalidateQuotationPaths(updated.serviceRequestId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=quotation-updated`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("mismatch") || lower.includes("invalid")) {
        redirect(withErrorCode(redirectTo, "quotation-mismatch"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "quotation-not-found"));
      }
    }
    throw error;
  }
}

export async function updateQuotationStatusAction(quotationId: string, formData: FormData) {
  const session = await requirePermission("quotations.status.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const parsed = quotationStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });
  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "quotation-status-validation"));
  }

  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    redirect(withErrorCode(redirectTo, "quotation-not-found"));
  }

  if (parsed.data.status === ApprovalStatus.APPROVED) {
    await requirePermission("quotations.approve");
  }

  const updated = await updateQuotationStatus(session, quotationId, parsed.data);
  await logActivity({
    action: "quotation.status_change",
    module: "quotations",
    entityType: "QUOTATION",
    entityId: updated.id,
    message: `Quotation status changed to ${updated.status}`,
    metadata: {
      status: updated.status,
    },
    servicePartnerId: updated.servicePartnerId,
  });

  revalidateQuotationPaths(updated.serviceRequestId);
  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=quotation-status-updated`);
}

export async function submitQuotationAction(quotationId: string, formData: FormData) {
  const session = await requirePermission("quotations.submit");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    redirect(withErrorCode(redirectTo, "quotation-not-found"));
  }

  const updated = await submitQuotation(session, quotationId);
  await logActivity({
    action: "quotation.status_change",
    module: "quotations",
    entityType: "QUOTATION",
    entityId: updated.id,
    message: "Quotation submitted",
    metadata: {
      previousStatus: existing.status,
      status: ApprovalStatus.PENDING,
    },
    servicePartnerId: updated.servicePartnerId,
  });

  revalidateQuotationPaths(updated.serviceRequestId);
  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=quotation-submitted`);
}

export async function deleteQuotationAction(quotationId: string, formData: FormData) {
  const session = await requirePermission("quotations.delete");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    redirect(withErrorCode(redirectTo, "quotation-not-found"));
  }

  const deleted = await softDeleteQuotation(session, quotationId);
  await logActivity({
    action: "quotation.delete",
    module: "quotations",
    entityType: "QUOTATION",
    entityId: deleted.id,
    message: "Quotation deleted",
    metadata: {
      quotationNumber: deleted.quotationNumber,
    },
    servicePartnerId: deleted.servicePartnerId,
  });

  revalidateQuotationPaths(deleted.serviceRequestId);
  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=quotation-deleted`);
}
