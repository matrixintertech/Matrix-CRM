"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";
import {
  createSubcategory,
  createSubcategoryForAllServicePartners,
  getServicePartnerIdForSubcategoryWrite,
} from "@/features/subcategories/services/subcategory.service";
import { subcategoryUpsertSchema } from "@/features/subcategories/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isCategoryTenantError(error: unknown) {
  return error instanceof Error && (error.message.includes("mismatch") || error.message.includes("Category not found"));
}

export async function createSubcategoryAction(formData: FormData) {
  const session = await requirePermission("categories.create");
  const parsed = subcategoryUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    categoryId: getFormString(formData, "categoryId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    description: getFormString(formData, "description"),
  });

  if (!parsed.success) {
    redirect("/subcategories/new?error=validation");
  }

  if (parsed.data.servicePartnerId === ALL_SERVICE_PARTNERS_OPTION) {
    if (!session.user.isSuperAdmin) {
      redirect("/subcategories/new?error=service-partner");
    }

    try {
      const subcategories = await createSubcategoryForAllServicePartners(session, parsed.data);
      await Promise.all(
        subcategories.map((subcategory) =>
          logActivity({
            action: "subcategory.create",
            module: "categories",
            entityType: "OTHER",
            entityId: subcategory.id,
            message: "Subcategory created",
            servicePartnerId: subcategory.servicePartnerId,
          })
        )
      );
      revalidatePath("/subcategories");
      revalidatePath("/items");
      redirect("/subcategories?success=created-all");
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        redirect("/subcategories/new?error=duplicate");
      }
      if (isCategoryTenantError(error)) {
        redirect("/subcategories/new?error=mismatch");
      }
      throw error;
    }
  }

  const servicePartnerId = getServicePartnerIdForSubcategoryWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/subcategories/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const subcategory = await createSubcategory(session, parsed.data);
    await logActivity({
      action: "subcategory.create",
      module: "categories",
      entityType: "OTHER",
      entityId: subcategory.id,
      message: "Subcategory created",
      servicePartnerId: subcategory.servicePartnerId,
    });
    revalidatePath("/subcategories");
    revalidatePath("/items");
    redirect("/subcategories?success=created");
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/subcategories/new?error=duplicate");
    }
    if (isCategoryTenantError(error)) {
      redirect("/subcategories/new?error=mismatch");
    }
    throw error;
  }
}
