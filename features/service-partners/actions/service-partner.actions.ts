"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { LocationSelectionError } from "@/features/locations/services/location.service";
import { logActivity } from "@/lib/activity/activity-log";
import { redirectForbidden } from "@/lib/auth/access-control";
import { requirePermission } from "@/lib/auth/rbac";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import {
  canManageServicePartners,
  createServicePartner,
  getServicePartnerById,
  isPlatformServicePartnerCode,
  softDeleteServicePartner,
  updateServicePartner,
  updateServicePartnerStatus,
} from "@/features/service-partners/services/service-partner.service";
import { servicePartnerStatusSchema, servicePartnerUpsertSchema } from "@/features/service-partners/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseUpsertInput(formData: FormData) {
  return servicePartnerUpsertSchema.safeParse({
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    legalName: getFormString(formData, "legalName"),
    email: getFormString(formData, "email"),
    phone: getFormString(formData, "phone"),
    address: getFormString(formData, "address"),
    city: getFormString(formData, "city"),
    state: getFormString(formData, "state"),
    country: getFormString(formData, "country"),
    postalCode: getFormString(formData, "postalCode"),
    status: getFormString(formData, "status"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function assertCanManageServicePartners(isAllowed: boolean) {
  if (!isAllowed) {
    redirectForbidden("/service-partners");
  }
}

function revalidateServicePartnerPaths(id: string) {
  revalidatePath("/service-partners");
  revalidatePath(`/service-partners/${id}`);
}

export async function createServicePartnerAction(formData: FormData) {
  const session = await requirePermission("service_partners.create");
  assertCanManageServicePartners(canManageServicePartners(session));

  const parsed = parseUpsertInput(formData);
  if (!parsed.success) {
    redirect("/service-partners/new?error=validation");
  }

  try {
    const servicePartner = await createServicePartner(parsed.data);
    await logActivity({
      action: "service_partner.create",
      module: "service_partners",
      entityType: "OTHER",
      entityId: servicePartner.id,
      servicePartnerId: servicePartner.id,
      message: "Service partner created",
    });
    revalidatePath("/service-partners");
    redirect(`/service-partners/${servicePartner.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/service-partners/new?error=duplicate");
    }
    if (error instanceof LocationSelectionError) {
      redirect("/service-partners/new?error=location");
    }
    throw error;
  }
}

export async function updateServicePartnerAction(id: string, formData: FormData) {
  const session = await requirePermission("service_partners.update");
  assertCanManageServicePartners(canManageServicePartners(session));

  const existing = await getServicePartnerById(session, id);
  if (!existing) {
    throw new Error("Service partner not found.");
  }

  const parsed = parseUpsertInput(formData);
  if (!parsed.success) {
    redirect(`/service-partners/${id}/edit?error=validation`);
  }

  if (isPlatformServicePartnerCode(existing.code) && parsed.data.code.trim().toUpperCase() !== existing.code) {
    redirect(`/service-partners/${id}?error=platform-protected`);
  }

  try {
    const servicePartner = await updateServicePartner(id, parsed.data);
    await logActivity({
      action: "service_partner.update",
      module: "service_partners",
      entityType: "OTHER",
      entityId: servicePartner.id,
      servicePartnerId: servicePartner.id,
      message: "Service partner updated",
    });
    revalidateServicePartnerPaths(servicePartner.id);
    redirect(`/service-partners/${servicePartner.id}?success=updated`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect(`/service-partners/${id}/edit?error=duplicate`);
    }
    if (error instanceof LocationSelectionError) {
      redirect(`/service-partners/${id}/edit?error=location`);
    }
    throw error;
  }
}

export async function updateServicePartnerStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("service_partners.update");
  assertCanManageServicePartners(canManageServicePartners(session));

  const existing = await getServicePartnerById(session, id);
  if (!existing) {
    throw new Error("Service partner not found.");
  }

  const parsed = servicePartnerStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });
  if (!parsed.success) {
    redirect(`/service-partners/${id}?error=validation`);
  }

  if (isPlatformServicePartnerCode(existing.code) && parsed.data.status !== "ACTIVE") {
    redirect(`/service-partners/${id}?error=platform-protected`);
  }

  const servicePartner = await updateServicePartnerStatus(id, parsed.data.status);
  await logActivity({
    action: "service_partner.status_change",
    module: "service_partners",
    entityType: "OTHER",
    entityId: servicePartner.id,
    servicePartnerId: servicePartner.id,
    message: `Service partner status changed to ${parsed.data.status}`,
  });
  revalidateServicePartnerPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/service-partners/${id}`));
}

export async function deleteServicePartnerAction(id: string, formData: FormData) {
  const session = await requirePermission("service_partners.delete");
  assertCanManageServicePartners(canManageServicePartners(session));

  const existing = await getServicePartnerById(session, id);
  if (!existing) {
    throw new Error("Service partner not found.");
  }

  if (isPlatformServicePartnerCode(existing.code)) {
    redirect(`/service-partners/${id}?error=platform-protected`);
  }

  const servicePartner = await softDeleteServicePartner(id);
  await logActivity({
    action: "service_partner.delete",
    module: "service_partners",
    entityType: "OTHER",
    entityId: servicePartner.id,
    servicePartnerId: servicePartner.id,
    message: "Service partner soft deleted",
  });
  revalidateServicePartnerPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/service-partners?success=deleted"));
}
