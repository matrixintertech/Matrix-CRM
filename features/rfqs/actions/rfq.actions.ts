"use server";

import { Prisma, RfqStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createRfq,
  getRfqById,
  getServicePartnerIdForRfqWrite,
  sendRfqToVendors,
  softDeleteRfq,
  updateRfq,
  updateRfqStatus,
  updateRfqVendorQuote,
} from "@/features/rfqs/services/rfq.service";
import { rfqSendSchema, rfqStatusSchema, rfqUpsertSchema, rfqVendorQuoteUpdateSchema } from "@/features/rfqs/validations";
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

function parseRfqInput(formData: FormData) {
  return rfqUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    clientId: getFormString(formData, "clientId"),
    serviceRequestId: getFormString(formData, "serviceRequestId"),
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    status: getFormString(formData, "status"),
    dueDate: getFormString(formData, "dueDate"),
    lines: parseJsonArray(formData, "linesJson"),
    vendors: parseJsonArray(formData, "vendorsJson"),
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
      error.message.toLowerCase().includes("not found") ||
      error.message.toLowerCase().includes("duplicate"))
  );
}

function revalidateRfqPaths(rfqId: string) {
  revalidatePath("/rfqs");
  revalidatePath(`/rfqs/${rfqId}`);
}

function asLineKey(line: { itemId: string; quantity: number; specs: string | null; remarks: string | null }) {
  return `${line.itemId}:${line.quantity}:${line.specs ?? ""}:${line.remarks ?? ""}`;
}

function asVendorKey(vendor: {
  vendorId: string;
  status: string;
  quotedAmount: number | null;
  notes: string | null;
}) {
  return `${vendor.vendorId}:${vendor.status}:${vendor.quotedAmount ?? ""}:${vendor.notes ?? ""}`;
}

export async function createRfqAction(formData: FormData) {
  const session = await requirePermission("rfq.create");
  const parsed = parseRfqInput(formData);

  if (!parsed.success) {
    redirect("/rfqs/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForRfqWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/rfqs/new?error=service-partner");
  }
  await requireTenantAccess(servicePartnerId);

  try {
    const rfq = await createRfq(session, parsed.data);
    await logActivity({
      action: "rfq.create",
      module: "rfq",
      entityType: "RFQ",
      entityId: rfq.id,
      message: "RFQ created",
      metadata: {
        rfqNumber: rfq.rfqNumber,
        status: rfq.status,
      },
      servicePartnerId: rfq.servicePartnerId,
    });

    for (const line of parsed.data.lines) {
      await logActivity({
        action: "rfq.line_add",
        module: "rfq",
        entityType: "RFQ",
        entityId: rfq.id,
        message: "RFQ line added",
        metadata: {
          itemId: line.itemId,
          quantity: line.quantity,
          specs: line.specs ?? line.description ?? null,
          remarks: line.remarks ?? null,
        },
        servicePartnerId: rfq.servicePartnerId,
      });
    }

    for (const vendor of parsed.data.vendors) {
      await logActivity({
        action: "rfq.vendor_add",
        module: "rfq",
        entityType: "RFQ",
        entityId: rfq.id,
        message: "RFQ vendor added",
        metadata: {
          vendorId: vendor.vendorId,
          status: vendor.status ?? "INVITED",
        },
        servicePartnerId: rfq.servicePartnerId,
      });
    }

    revalidatePath("/rfqs");
    redirect(`/rfqs/${rfq.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/rfqs/new?error=duplicate");
    }
    if (isTenantMismatchError(error)) {
      redirect("/rfqs/new?error=mismatch");
    }
    throw error;
  }
}

export async function updateRfqAction(id: string, formData: FormData) {
  const session = await requirePermission("rfq.update");
  const parsed = parseRfqInput(formData);

  if (!parsed.success) {
    redirect(`/rfqs/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForRfqWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/rfqs/${id}/edit?error=service-partner`);
  }

  const existing = await getRfqById(session, id);
  if (!existing) {
    redirect(`/rfqs/${id}/edit?error=not-found`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const rfq = await updateRfq(session, id, parsed.data);

    await logActivity({
      action: "rfq.update",
      module: "rfq",
      entityType: "RFQ",
      entityId: rfq.id,
      message: "RFQ updated",
      metadata: {
        status: rfq.status,
        lineCount: parsed.data.lines.length,
        vendorCount: parsed.data.vendors.length,
      },
      servicePartnerId: rfq.servicePartnerId,
    });

    const beforeLines = new Map(
      existing.items.map((line) => [
        line.itemId,
        {
          itemId: line.itemId,
          quantity: Number(line.quantity),
          specs: line.specs,
          remarks: line.remarks,
        },
      ])
    );
    const afterLines = new Map(
      parsed.data.lines.map((line) => [
        line.itemId,
        {
          itemId: line.itemId,
          quantity: line.quantity,
          specs: line.specs ?? line.description ?? null,
          remarks: line.remarks ?? null,
        },
      ])
    );

    for (const [itemId, line] of afterLines.entries()) {
      const before = beforeLines.get(itemId);
      if (!before) {
        await logActivity({
          action: "rfq.line_add",
          module: "rfq",
          entityType: "RFQ",
          entityId: rfq.id,
          message: "RFQ line added",
          metadata: line,
          servicePartnerId: rfq.servicePartnerId,
        });
        continue;
      }

      if (asLineKey(before) !== asLineKey(line)) {
        await logActivity({
          action: "rfq.line_update",
          module: "rfq",
          entityType: "RFQ",
          entityId: rfq.id,
          message: "RFQ line updated",
          metadata: {
            itemId,
            previous: before,
            next: line,
          },
          servicePartnerId: rfq.servicePartnerId,
        });
      }
    }

    for (const [itemId, line] of beforeLines.entries()) {
      if (afterLines.has(itemId)) {
        continue;
      }
      await logActivity({
        action: "rfq.line_delete",
        module: "rfq",
        entityType: "RFQ",
        entityId: rfq.id,
        message: "RFQ line deleted",
        metadata: {
          itemId,
          line,
        },
        servicePartnerId: rfq.servicePartnerId,
      });
    }

    const beforeVendors = new Map(
      existing.vendorQuotes.map((quote) => [
        quote.vendorId,
        {
          vendorId: quote.vendorId,
          status: quote.status,
          quotedAmount: quote.quotedAmount === null ? null : Number(quote.quotedAmount),
          notes: quote.notes,
        },
      ])
    );
    const afterVendors = new Map(
      parsed.data.vendors.map((vendor) => [
        vendor.vendorId,
        {
          vendorId: vendor.vendorId,
          status: vendor.status ?? "INVITED",
          quotedAmount: vendor.quotedAmount ?? null,
          notes: vendor.notes ?? null,
        },
      ])
    );

    for (const [vendorId, vendor] of afterVendors.entries()) {
      const before = beforeVendors.get(vendorId);
      if (!before) {
        await logActivity({
          action: "rfq.vendor_add",
          module: "rfq",
          entityType: "RFQ",
          entityId: rfq.id,
          message: "RFQ vendor added",
          metadata: vendor,
          servicePartnerId: rfq.servicePartnerId,
        });
        continue;
      }

      if (asVendorKey(before) !== asVendorKey(vendor)) {
        await logActivity({
          action: "rfq.vendor_update",
          module: "rfq",
          entityType: "RFQ",
          entityId: rfq.id,
          message: "RFQ vendor updated",
          metadata: {
            vendorId,
            previous: before,
            next: vendor,
          },
          servicePartnerId: rfq.servicePartnerId,
        });
      }
    }

    for (const [vendorId, vendor] of beforeVendors.entries()) {
      if (afterVendors.has(vendorId)) {
        continue;
      }
      await logActivity({
        action: "rfq.vendor_remove",
        module: "rfq",
        entityType: "RFQ",
        entityId: rfq.id,
        message: "RFQ vendor removed",
        metadata: {
          vendorId,
          vendor,
        },
        servicePartnerId: rfq.servicePartnerId,
      });
    }

    revalidateRfqPaths(rfq.id);
    redirect(`/rfqs/${rfq.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/rfqs/${id}/edit?error=duplicate`);
    }
    if (isTenantMismatchError(error)) {
      redirect(`/rfqs/${id}/edit?error=mismatch`);
    }
    throw error;
  }
}

export async function updateRfqStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("rfq.status.update");
  const parsed = rfqStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(`/rfqs/${id}?error=status-validation`);
  }

  const existing = await getRfqById(session, id);
  if (!existing) {
    redirect(`/rfqs/${id}?error=not-found`);
  }

  await requireTenantAccess(existing.servicePartnerId);

  const rfq = await updateRfqStatus(session, id, parsed.data.status);
  await logActivity({
    action: "rfq.status_change",
    module: "rfq",
    entityType: "RFQ",
    entityId: rfq.id,
    message: `RFQ status changed to ${parsed.data.status}`,
    metadata: {
      status: parsed.data.status,
    },
    servicePartnerId: rfq.servicePartnerId,
  });

  revalidateRfqPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/rfqs/${id}`));
}

export async function sendRfqAction(id: string, formData: FormData) {
  const session = await requirePermission("rfq.send");
  const parsed = rfqSendSchema.safeParse({
    sentAt: getFormString(formData, "sentAt"),
  });

  if (!parsed.success) {
    redirect(`/rfqs/${id}?error=validation`);
  }

  const existing = await getRfqById(session, id);
  if (!existing) {
    redirect(`/rfqs/${id}?error=not-found`);
  }

  await requireTenantAccess(existing.servicePartnerId);

  const rfq = await sendRfqToVendors(session, id);
  await logActivity({
    action: "rfq.status_change",
    module: "rfq",
    entityType: "RFQ",
    entityId: rfq.id,
    message: "RFQ sent to vendors",
    metadata: {
      status: RfqStatus.PUBLISHED,
      vendorCount: existing.vendorQuotes.length,
      sentAt: parsed.data.sentAt ?? new Date(),
    },
    servicePartnerId: rfq.servicePartnerId,
  });

  revalidateRfqPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/rfqs/${id}?success=sent`));
}

export async function deleteRfqAction(id: string, formData: FormData) {
  const session = await requirePermission("rfq.delete");
  const existing = await getRfqById(session, id);

  if (!existing) {
    redirect(`/rfqs?error=not-found`);
  }

  await requireTenantAccess(existing.servicePartnerId);

  await softDeleteRfq(session, id);
  await logActivity({
    action: "rfq.delete",
    module: "rfq",
    entityType: "RFQ",
    entityId: id,
    message: "RFQ soft deleted",
    servicePartnerId: existing.servicePartnerId,
  });

  revalidateRfqPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/rfqs?success=deleted"));
}

export async function updateRfqVendorQuoteAction(rfqId: string, formData: FormData) {
  const session = await requirePermission("vendor_quotations.update");
  const parsed = rfqVendorQuoteUpdateSchema.safeParse({
    vendorId: getFormString(formData, "vendorId"),
    status: getFormString(formData, "status"),
    quotedAmount: getFormString(formData, "quotedAmount"),
    notes: getFormString(formData, "notes"),
  });

  if (!parsed.success) {
    redirect(`/rfqs/${rfqId}?error=vendor-quote-validation`);
  }

  const existing = await getRfqById(session, rfqId);
  if (!existing) {
    redirect(`/rfqs/${rfqId}?error=not-found`);
  }
  await requireTenantAccess(existing.servicePartnerId);

  const updated = await updateRfqVendorQuote(session, rfqId, parsed.data);
  await logActivity({
    action: "rfq.vendor_quote_update",
    module: "rfq",
    entityType: "RFQ",
    entityId: rfqId,
    message: "Vendor quotation updated",
    metadata: {
      vendorId: updated.vendorId,
      status: updated.status,
      quotedAmount: updated.quotedAmount === null ? null : Number(updated.quotedAmount),
    },
    servicePartnerId: existing.servicePartnerId,
  });

  revalidateRfqPaths(rfqId);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/rfqs/${rfqId}?success=vendor-quote-updated`));
}
