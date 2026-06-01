"use server";

import { InvoiceStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createInvoice,
  getInvoiceById,
  getServicePartnerIdForInvoiceWrite,
  softDeleteInvoice,
  updateInvoice,
  updateInvoiceStatus,
} from "@/features/invoices/services/invoice.service";
import { invoiceStatusSchema, invoiceUpsertSchema } from "@/features/invoices/validations";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseJsonArray(formData: FormData, key: string) {
  const raw = getFormString(formData, key);
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

function parseInvoiceInput(formData: FormData) {
  return invoiceUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    vendorId: getFormString(formData, "vendorId"),
    purchaseOrderId: getFormString(formData, "purchaseOrderId"),
    rfqId: getFormString(formData, "rfqId"),
    serviceRequestId: getFormString(formData, "serviceRequestId"),
    status: getFormString(formData, "status"),
    invoiceDate: getFormString(formData, "invoiceDate"),
    dueDate: getFormString(formData, "dueDate"),
    notes: getFormString(formData, "notes"),
    items: parseJsonArray(formData, "itemsJson"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTenantMismatchError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.toLowerCase().includes("mismatch") ||
      error.message.toLowerCase().includes("invalid") ||
      error.message.toLowerCase().includes("not found"))
  );
}

function isStatusTransitionError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("status transition is not allowed");
}

function isEditBlockedError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("cannot be edited");
}

function revalidateInvoicePaths(invoiceId: string, purchaseOrderId?: string | null) {
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (purchaseOrderId) {
    revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  }
}

function asLineKey(line: {
  itemId: string;
  quantity: number;
  unitRate: number;
  taxPercent: number | null;
  amount: number;
}) {
  return `${line.itemId}:${line.quantity}:${line.unitRate}:${line.taxPercent ?? ""}:${line.amount}`;
}

export async function createInvoiceAction(formData: FormData) {
  const session = await requirePermission("invoices.create");
  const parsed = parseInvoiceInput(formData);

  if (!parsed.success) {
    redirect("/invoices/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForInvoiceWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/invoices/new?error=service-partner");
  }
  await requireTenantAccess(servicePartnerId);

  try {
    const invoice = await createInvoice(session, parsed.data);
    await logActivity({
      action: "invoice.create",
      module: "invoices",
      entityType: "INVOICE",
      entityId: invoice.id,
      message: "Invoice created",
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        vendorId: invoice.vendorId,
        lineCount: parsed.data.items.length,
      },
      servicePartnerId: invoice.servicePartnerId,
    });

    for (const line of parsed.data.items) {
      await logActivity({
        action: "invoice.line_add",
        module: "invoices",
        entityType: "INVOICE",
        entityId: invoice.id,
        message: "Invoice line added",
        metadata: {
          itemId: line.itemId,
          quantity: line.quantity,
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? null,
        },
        servicePartnerId: invoice.servicePartnerId,
      });
    }

    revalidateInvoicePaths(invoice.id, invoice.purchaseOrderId);
    redirect(`/invoices/${invoice.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/invoices/new?error=duplicate");
    }
    if (isStatusTransitionError(error)) {
      redirect("/invoices/new?error=invalid-transition");
    }
    if (isTenantMismatchError(error)) {
      redirect("/invoices/new?error=mismatch");
    }
    throw error;
  }
}

export async function updateInvoiceAction(id: string, formData: FormData) {
  const session = await requirePermission("invoices.update");
  const parsed = parseInvoiceInput(formData);

  if (!parsed.success) {
    redirect(`/invoices/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForInvoiceWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/invoices/${id}/edit?error=service-partner`);
  }

  const existing = await getInvoiceById(session, id);
  if (!existing) {
    redirect(`/invoices/${id}/edit?error=not-found`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const invoice = await updateInvoice(session, id, parsed.data);
    await logActivity({
      action: "invoice.update",
      module: "invoices",
      entityType: "INVOICE",
      entityId: invoice.id,
      message: "Invoice updated",
      metadata: {
        status: invoice.status,
        vendorId: invoice.vendorId,
        lineCount: parsed.data.items.length,
      },
      servicePartnerId: invoice.servicePartnerId,
    });

    const beforeLines = new Map(
      existing.items.map((line) => [
        line.itemId,
        {
          itemId: line.itemId,
          quantity: Number(line.quantity),
          unitRate: Number(line.unitRate),
          taxPercent: line.taxPercent === null ? null : Number(line.taxPercent),
          amount: Number(line.amount),
        },
      ])
    );
    const afterLines = new Map(
      parsed.data.items.map((line) => {
        const quantity = Number(line.quantity);
        const unitRate = Number(line.unitRate);
        const taxPercent = line.taxPercent ?? null;
        const lineSubtotal = quantity * unitRate;
        const lineTax = lineSubtotal * ((taxPercent ?? 0) / 100);
        const amount = Math.round((lineSubtotal + lineTax + Number.EPSILON) * 100) / 100;
        return [
          line.itemId,
          {
            itemId: line.itemId,
            quantity,
            unitRate,
            taxPercent,
            amount,
          },
        ] as const;
      })
    );

    for (const [itemId, line] of afterLines.entries()) {
      const before = beforeLines.get(itemId);
      if (!before) {
        await logActivity({
          action: "invoice.line_add",
          module: "invoices",
          entityType: "INVOICE",
          entityId: invoice.id,
          message: "Invoice line added",
          metadata: line,
          servicePartnerId: invoice.servicePartnerId,
        });
        continue;
      }

      if (asLineKey(before) !== asLineKey(line)) {
        await logActivity({
          action: "invoice.line_update",
          module: "invoices",
          entityType: "INVOICE",
          entityId: invoice.id,
          message: "Invoice line updated",
          metadata: {
            itemId,
            previous: before,
            next: line,
          },
          servicePartnerId: invoice.servicePartnerId,
        });
      }
    }

    for (const [itemId, line] of beforeLines.entries()) {
      if (afterLines.has(itemId)) {
        continue;
      }
      await logActivity({
        action: "invoice.line_delete",
        module: "invoices",
        entityType: "INVOICE",
        entityId: invoice.id,
        message: "Invoice line deleted",
        metadata: {
          itemId,
          line,
        },
        servicePartnerId: invoice.servicePartnerId,
      });
    }

    revalidateInvoicePaths(invoice.id, invoice.purchaseOrderId);
    redirect(`/invoices/${invoice.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/invoices/${id}/edit?error=duplicate`);
    }
    if (isStatusTransitionError(error)) {
      redirect(`/invoices/${id}/edit?error=invalid-transition`);
    }
    if (isEditBlockedError(error)) {
      redirect(`/invoices/${id}/edit?error=edit-blocked`);
    }
    if (isTenantMismatchError(error)) {
      redirect(`/invoices/${id}/edit?error=mismatch`);
    }
    throw error;
  }
}

export async function updateInvoiceStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("invoices.status.update");
  const parsed = invoiceStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(`/invoices/${id}?error=status-validation`);
  }

  const existing = await getInvoiceById(session, id);
  if (!existing) {
    redirect(`/invoices/${id}?error=not-found`);
  }

  await requireTenantAccess(existing.servicePartnerId);

  if (parsed.data.status === InvoiceStatus.SUBMITTED) {
    await requirePermission("invoices.send");
  }
  if (parsed.data.status === InvoiceStatus.APPROVED) {
    await requirePermission("invoices.approve");
  }

  try {
    const invoice = await updateInvoiceStatus(session, id, parsed.data.status);
    await logActivity({
      action: "invoice.status_change",
      module: "invoices",
      entityType: "INVOICE",
      entityId: invoice.id,
      message: `Invoice status changed to ${parsed.data.status}`,
      metadata: {
        status: parsed.data.status,
      },
      servicePartnerId: invoice.servicePartnerId,
    });

    revalidateInvoicePaths(id, existing.purchaseOrderId);
    redirect(getSafeRedirectPath(formData.get("redirectTo"), `/invoices/${id}`));
  } catch (error) {
    if (isStatusTransitionError(error)) {
      redirect(`/invoices/${id}?error=invalid-transition`);
    }
    throw error;
  }
}

export async function deleteInvoiceAction(id: string, formData: FormData) {
  const session = await requirePermission("invoices.delete");
  const existing = await getInvoiceById(session, id);

  if (!existing) {
    redirect("/invoices?error=not-found");
  }

  await requireTenantAccess(existing.servicePartnerId);
  await softDeleteInvoice(session, id);

  await logActivity({
    action: "invoice.delete",
    module: "invoices",
    entityType: "INVOICE",
    entityId: id,
    message: "Invoice soft deleted",
    servicePartnerId: existing.servicePartnerId,
  });

  revalidateInvoicePaths(id, existing.purchaseOrderId);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/invoices?success=deleted"));
}
