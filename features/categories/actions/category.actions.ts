"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  createCategoryForAllServicePartners,
  createCategory,
  getCategoryById,
  getServicePartnerIdForCategoryWrite,
  softDeleteCategory,
  updateCategory,
} from "@/features/categories/services/category.service";
import { categoryUpsertSchema } from "@/features/categories/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseCategoryInput(formData: FormData) {
  return categoryUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    description: getFormString(formData, "description"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function revalidateCategoryPaths(categoryId: string) {
  revalidatePath("/categories");
  revalidatePath(`/categories/${categoryId}`);
}

export async function createCategoryAction(formData: FormData) {
  const session = await requirePermission("categories.create");
  const parsed = parseCategoryInput(formData);

  if (!parsed.success) {
    redirect("/categories/new?error=validation");
  }

  if (parsed.data.servicePartnerId === ALL_SERVICE_PARTNERS_OPTION) {
    if (!session.user.isSuperAdmin) {
      redirect("/categories/new?error=service-partner");
    }

    try {
      const categories = await createCategoryForAllServicePartners(session, parsed.data);
      await Promise.all(
        categories.map((category) =>
          logActivity({
            action: "category.create",
            module: "categories",
            entityType: "OTHER",
            entityId: category.id,
            message: "Category created",
            servicePartnerId: category.servicePartnerId,
          })
        )
      );
      revalidatePath("/categories");
      redirect("/categories?success=created-all");
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        redirect("/categories/new?error=duplicate");
      }
      throw error;
    }
  }

  const servicePartnerId = getServicePartnerIdForCategoryWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/categories/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const category = await createCategory(session, parsed.data);
    await logActivity({
      action: "category.create",
      module: "categories",
      entityType: "OTHER",
      entityId: category.id,
      message: "Category created",
      servicePartnerId: category.servicePartnerId,
    });
    revalidatePath("/categories");
    redirect(`/categories/${category.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/categories/new?error=duplicate");
    }
    throw error;
  }
}

export async function updateCategoryAction(id: string, formData: FormData) {
  const session = await requirePermission("categories.update");
  const parsed = parseCategoryInput(formData);

  if (!parsed.success) {
    redirect(`/categories/${id}/edit?error=validation`);
  }

  if (!parsed.data.servicePartnerId || parsed.data.servicePartnerId === ALL_SERVICE_PARTNERS_OPTION) {
    redirect(`/categories/${id}/edit?error=service-partner`);
  }

  const servicePartnerId = getServicePartnerIdForCategoryWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(`/categories/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const category = await updateCategory(session, id, parsed.data);
    await logActivity({
      action: "category.update",
      module: "categories",
      entityType: "OTHER",
      entityId: category.id,
      message: "Category updated",
      servicePartnerId: category.servicePartnerId,
    });
    revalidateCategoryPaths(category.id);
    redirect(`/categories/${category.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/categories/${id}/edit?error=duplicate`);
    }
    throw error;
  }
}

export async function deleteCategoryAction(id: string, formData: FormData) {
  const session = await requirePermission("categories.delete");
  const category = await getCategoryById(session, id);

  if (!category) {
    throw new Error("Category not found.");
  }

  await requireTenantAccess(category.servicePartnerId);

  await softDeleteCategory(id);
  await logActivity({
    action: "category.delete",
    module: "categories",
    entityType: "OTHER",
    entityId: id,
    message: "Category soft deleted",
    servicePartnerId: category.servicePartnerId,
  });

  revalidateCategoryPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/categories?success=deleted"));
}
