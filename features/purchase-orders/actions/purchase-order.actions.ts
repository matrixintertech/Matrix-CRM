"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createPurchaseOrder,
  getPurchaseOrderById,
  getServicePartnerIdForPurchaseOrderWrite,
  softDeletePurchaseOrder,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} from "@/features/purchase-orders/services/purchase-order.service";
import { purchaseOrderStatusSchema, purchaseOrderUpsertSchema } from "@/features/purchase-orders/validations";
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

function parsePurchaseOrderInput(formData: FormData) {
  return purchaseOrderUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    rfqId: getFormString(formData, "rfqId"),
    serviceRequestId: getFormString(formData, "serviceRequestId"),
    vendorId: getFormString(formData, "vendorId"),
    status: getFormString(formData, "status"),
    orderDate: getFormString(formData, "orderDate"),
    expectedDate: getFormString(formData, "expectedDate"),
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

function revalidatePurchaseOrderPaths(purchaseOrderId: string) {
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
}

export async function createPurchaseOrderAction(formData: FormData) {
  const session = await requirePermission("purchase_orders.create");
  const parsed = parsePurchaseOrderInput(formData);

  if (!parsed.success) {
    redirect("/purchase-orders/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForPurchaseOrderWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/purchase-orders/new?error=service-partner");
  }
  await requireTenantAccess(servicePartnerId);

  try {
    const purchaseOrder = await createPurchaseOrder(session, parsed.data);
    await logActivity({
      action: "purchase_order.create",
      module: "purchase_orders",
      entityType: "PURCHASE_ORDER",
      entityId: purchaseOrder.id,
      message: "Purchase order created",
      metadata: {
        poNumber: purchaseOrder.poNumber,
        status: purchaseOrder.status,
        vendorId: purchaseOrder.vendorId,
        lineCount: parsed.data.items.length,
      },
      servicePartnerId: purchaseOrder.servicePartnerId,
    });

    revalidatePath("/purchase-orders");
    redirect(`/purchase-orders/${purchaseOrder.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/purchase-orders/new?error=duplicate");
    }
    if (isStatusTransitionError(error)) {
      redirect("/purchase-orders/new?error=invalid-transition");
    }
    if (isTenantMismatchError(error)) {
      redirect("/purchase-orders/new?error=mismatch");
    }
    throw error;
  }
}

export async function updatePurchaseOrderAction(id: string, formData: FormData) {
  const session = await requirePermission("purchase_orders.update");
  const parsed = parsePurchaseOrderInput(formData);

  if (!parsed.success) {
    redirect(`/purchase-orders/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForPurchaseOrderWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/purchase-orders/${id}/edit?error=service-partner`);
  }

  const existing = await getPurchaseOrderById(session, id);
  if (!existing) {
    redirect(`/purchase-orders/${id}/edit?error=not-found`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const purchaseOrder = await updatePurchaseOrder(session, id, parsed.data);
    await logActivity({
      action: "purchase_order.update",
      module: "purchase_orders",
      entityType: "PURCHASE_ORDER",
      entityId: purchaseOrder.id,
      message: "Purchase order updated",
      metadata: {
        status: purchaseOrder.status,
        vendorId: purchaseOrder.vendorId,
        lineCount: parsed.data.items.length,
      },
      servicePartnerId: purchaseOrder.servicePartnerId,
    });

    revalidatePurchaseOrderPaths(purchaseOrder.id);
    redirect(`/purchase-orders/${purchaseOrder.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/purchase-orders/${id}/edit?error=duplicate`);
    }
    if (isStatusTransitionError(error)) {
      redirect(`/purchase-orders/${id}/edit?error=invalid-transition`);
    }
    if (isTenantMismatchError(error)) {
      redirect(`/purchase-orders/${id}/edit?error=mismatch`);
    }
    throw error;
  }
}

export async function updatePurchaseOrderStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("purchase_orders.status.update");
  const parsed = purchaseOrderStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(`/purchase-orders/${id}?error=status-validation`);
  }

  const existing = await getPurchaseOrderById(session, id);
  if (!existing) {
    redirect(`/purchase-orders/${id}?error=not-found`);
  }

  await requireTenantAccess(existing.servicePartnerId);

  try {
    const purchaseOrder = await updatePurchaseOrderStatus(session, id, parsed.data.status);
    await logActivity({
      action: "purchase_order.status_change",
      module: "purchase_orders",
      entityType: "PURCHASE_ORDER",
      entityId: purchaseOrder.id,
      message: `Purchase order status changed to ${parsed.data.status}`,
      metadata: {
        status: parsed.data.status,
      },
      servicePartnerId: purchaseOrder.servicePartnerId,
    });

    revalidatePurchaseOrderPaths(id);
    redirect(getSafeRedirectPath(formData.get("redirectTo"), `/purchase-orders/${id}`));
  } catch (error) {
    if (isStatusTransitionError(error)) {
      redirect(`/purchase-orders/${id}?error=invalid-transition`);
    }
    throw error;
  }
}

export async function deletePurchaseOrderAction(id: string, formData: FormData) {
  const session = await requirePermission("purchase_orders.delete");
  const existing = await getPurchaseOrderById(session, id);

  if (!existing) {
    redirect("/purchase-orders?error=not-found");
  }

  await requireTenantAccess(existing.servicePartnerId);
  await softDeletePurchaseOrder(session, id);

  await logActivity({
    action: "purchase_order.delete",
    module: "purchase_orders",
    entityType: "PURCHASE_ORDER",
    entityId: id,
    message: "Purchase order soft deleted",
    servicePartnerId: existing.servicePartnerId,
  });

  revalidatePurchaseOrderPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/purchase-orders?success=deleted"));
}
