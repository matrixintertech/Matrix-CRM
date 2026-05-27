"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createItem,
  getItemById,
  getServicePartnerIdForItemWrite,
  softDeleteItem,
  updateItem,
  updateItemActive,
} from "@/features/items/services/item.service";
import { itemActiveSchema, itemUpsertSchema } from "@/features/items/validations";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseItemInput(formData: FormData) {
  return itemUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    categoryId: getFormString(formData, "categoryId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    unit: getFormString(formData, "unit"),
    description: getFormString(formData, "description"),
    active: getFormString(formData, "active"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isCategoryTenantError(error: unknown) {
  return error instanceof Error && (error.message.includes("mismatch") || error.message.includes("Category not found"));
}

function revalidateItemPaths(itemId: string) {
  revalidatePath("/items");
  revalidatePath(`/items/${itemId}`);
}

export async function createItemAction(formData: FormData) {
  const session = await requirePermission("items.create");
  const parsed = parseItemInput(formData);

  if (!parsed.success) {
    redirect("/items/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForItemWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/items/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const item = await createItem(session, parsed.data);
    await logActivity({
      action: "item.create",
      module: "items",
      entityType: "OTHER",
      entityId: item.id,
      message: "Item created",
      servicePartnerId: item.servicePartnerId,
    });
    revalidatePath("/items");
    redirect(`/items/${item.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/items/new?error=duplicate");
    }
    if (isCategoryTenantError(error)) {
      redirect("/items/new?error=mismatch");
    }
    throw error;
  }
}

export async function updateItemAction(id: string, formData: FormData) {
  const session = await requirePermission("items.update");
  const parsed = parseItemInput(formData);

  if (!parsed.success) {
    redirect(`/items/${id}/edit?error=validation`);
  }

  const servicePartnerId = getServicePartnerIdForItemWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/items/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const item = await updateItem(session, id, parsed.data);
    await logActivity({
      action: "item.update",
      module: "items",
      entityType: "OTHER",
      entityId: item.id,
      message: "Item updated",
      servicePartnerId: item.servicePartnerId,
    });
    revalidateItemPaths(item.id);
    redirect(`/items/${item.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/items/${id}/edit?error=duplicate`);
    }
    if (isCategoryTenantError(error)) {
      redirect(`/items/${id}/edit?error=mismatch`);
    }
    throw error;
  }
}

export async function updateItemActiveAction(id: string, formData: FormData) {
  const session = await requirePermission("items.update");
  const parsed = itemActiveSchema.safeParse({
    active: getFormString(formData, "active"),
  });

  if (!parsed.success) {
    redirect(`/items/${id}?error=validation`);
  }

  const item = await getItemById(session, id);
  if (!item) {
    throw new Error("Item not found.");
  }

  await requireTenantAccess(item.servicePartnerId);

  await updateItemActive(id, parsed.data.active);
  await logActivity({
    action: "item.status_change",
    module: "items",
    entityType: "OTHER",
    entityId: id,
    message: `Item active changed to ${parsed.data.active}`,
    servicePartnerId: item.servicePartnerId,
  });

  revalidateItemPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/items/${id}`));
}

export async function deleteItemAction(id: string, formData: FormData) {
  const session = await requirePermission("items.delete");
  const item = await getItemById(session, id);

  if (!item) {
    throw new Error("Item not found.");
  }

  await requireTenantAccess(item.servicePartnerId);

  await softDeleteItem(id);
  await logActivity({
    action: "item.delete",
    module: "items",
    entityType: "OTHER",
    entityId: id,
    message: "Item soft deleted",
    servicePartnerId: item.servicePartnerId,
  });

  revalidateItemPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/items?success=deleted"));
}

