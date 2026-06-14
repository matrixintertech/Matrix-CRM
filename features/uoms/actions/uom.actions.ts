"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";
import { createUom, createUomForAllServicePartners, getServicePartnerIdForUomWrite } from "@/features/uoms/services/uom.service";
import { uomUpsertSchema } from "@/features/uoms/validations";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function buildRedirectPath(path: string, params: Record<string, string | undefined>) {
  const [rawPathname, existingQuery = ""] = path.split("?");
  const pathname = rawPathname ?? path;
  const searchParams = new URLSearchParams(existingQuery);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function getNewUomFormRedirect(formData: FormData, error: string) {
  return buildRedirectPath("/uoms/new", {
    error,
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    redirectTo: getSafeRedirectPath(formData.get("redirectTo"), "/uoms"),
  });
}

export async function createUomAction(formData: FormData) {
  const session = await requirePermission("items.create");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/uoms");
  const parsed = uomUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    symbol: getFormString(formData, "symbol"),
    description: getFormString(formData, "description"),
    active: getFormString(formData, "active"),
  });

  if (!parsed.success) {
    redirect(getNewUomFormRedirect(formData, "validation"));
  }

  if (parsed.data.servicePartnerId === ALL_SERVICE_PARTNERS_OPTION) {
    if (!session.user.isSuperAdmin) {
      redirect(getNewUomFormRedirect(formData, "service-partner"));
    }

    try {
      const uoms = await createUomForAllServicePartners(session, parsed.data);
      await Promise.all(
        uoms.map((uom) =>
          logActivity({
            action: "uom.create",
            module: "items",
            entityType: "OTHER",
            entityId: uom.id,
            message: "UOM created",
            servicePartnerId: uom.servicePartnerId,
          })
        )
      );
      revalidatePath("/uoms");
      revalidatePath("/items");
      if (redirectTo !== "/uoms") {
        redirect(
          buildRedirectPath(redirectTo, {
            uomCode: parsed.data.code.trim().toUpperCase(),
          })
        );
      }
      redirect("/uoms?success=created-all");
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        redirect(getNewUomFormRedirect(formData, "duplicate"));
      }
      throw error;
    }
  }

  const servicePartnerId = getServicePartnerIdForUomWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect(getNewUomFormRedirect(formData, "service-partner"));
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const uom = await createUom(session, parsed.data);
    await logActivity({
      action: "uom.create",
      module: "items",
      entityType: "OTHER",
      entityId: uom.id,
      message: "UOM created",
      servicePartnerId: uom.servicePartnerId,
    });
    revalidatePath("/uoms");
    revalidatePath("/items");
    if (redirectTo !== "/uoms") {
      redirect(
        buildRedirectPath(redirectTo, {
          uomId: uom.id,
          uomCode: uom.code,
        })
      );
    }
    redirect("/uoms?success=created");
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(getNewUomFormRedirect(formData, "duplicate"));
    }
    throw error;
  }
}
