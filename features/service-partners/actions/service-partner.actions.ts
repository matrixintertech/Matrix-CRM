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
  deleteServicePartnerDocument,
  uploadServicePartnerDocument,
  updateServicePartner,
  updateServicePartnerStatus,
} from "@/features/service-partners/services/service-partner.service";
import { servicePartnerStatusSchema, servicePartnerUpsertSchema } from "@/features/service-partners/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function getFormFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

function parseUpsertInput(formData: FormData) {
  return servicePartnerUpsertSchema.safeParse({
    code: getFormString(formData, "code"),
    name: getFormString(formData, "name"),
    legalName: getFormString(formData, "legalName"),
    email: getFormString(formData, "email"),
    phone: getFormString(formData, "phone"),
    gstNumber: getFormString(formData, "gstNumber"),
    shortProfile: getFormString(formData, "shortProfile"),
    bankName: getFormString(formData, "bankName"),
    bankBranch: getFormString(formData, "bankBranch"),
    bankIfscCode: getFormString(formData, "bankIfscCode"),
    bankAccountNumber: getFormString(formData, "bankAccountNumber"),
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

function isSchemaBehindCodeError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return [
    "ServicePartner.gstNumber",
    "ServicePartner.shortProfile",
    "ServicePartner.bankName",
    "ServicePartner.bankBranch",
    "ServicePartner.bankIfscCode",
    "ServicePartner.bankAccountNumber",
    "Attachment.documentLabel",
  ].some((column) => error.message.includes(column));
}

function assertCanManageServicePartners(isAllowed: boolean) {
  if (!isAllowed) {
    redirectForbidden("/service-partners");
  }
}

function revalidateServicePartnerPaths(id: string) {
  revalidatePath("/service-partners");
  revalidatePath(`/service-partners/${id}`);
  revalidatePath(`/service-partners/${id}/edit`);
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
    if (isSchemaBehindCodeError(error)) {
      redirect("/service-partners/new?error=schema-outdated");
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
    if (isSchemaBehindCodeError(error)) {
      redirect(`/service-partners/${id}/edit?error=schema-outdated`);
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

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

export async function uploadServicePartnerDocumentAction(id: string, formData: FormData) {
  const session = await requirePermission("service_partners.update");
  assertCanManageServicePartners(canManageServicePartners(session));

  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/service-partners/${id}`);
  const file = getFormFile(formData, "file");
  if (!file) {
    redirect(withErrorCode(redirectTo, "document-validation"));
  }

  try {
    const result = await uploadServicePartnerDocument(session, id, {
      file,
      documentLabel: getFormString(formData, "documentLabel"),
      note: getFormString(formData, "note"),
    });
    await logActivity({
      action: "service_partner.document_upload",
      module: "service_partners",
      entityType: "OTHER",
      entityId: result.servicePartner.id,
      servicePartnerId: result.servicePartner.id,
      message: "Service partner document uploaded",
      metadata: {
        attachmentId: result.document.id,
        fileName: result.document.fileName,
        documentLabel: result.document.documentLabel,
      },
    });
    revalidateServicePartnerPaths(result.servicePartner.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=document-uploaded`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("allowed") || lower.includes("valid document") || lower.includes("upload limit")) {
        redirect(withErrorCode(redirectTo, "document-validation"));
      }
      if (lower.includes("configured") || lower.includes("require s3") || lower.includes("disabled")) {
        redirect(withErrorCode(redirectTo, "document-storage"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "document-not-found"));
      }
    }
    throw error;
  }
}

export async function deleteServicePartnerDocumentAction(id: string, attachmentId: string, formData: FormData) {
  const session = await requirePermission("service_partners.update");
  assertCanManageServicePartners(canManageServicePartners(session));

  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/service-partners/${id}`);

  try {
    const result = await deleteServicePartnerDocument(session, attachmentId);
    await logActivity({
      action: "service_partner.document_delete",
      module: "service_partners",
      entityType: "OTHER",
      entityId: result.servicePartner.id,
      servicePartnerId: result.servicePartner.id,
      message: "Service partner document deleted",
      metadata: {
        attachmentId: result.document.id,
        fileName: result.document.fileName,
        documentLabel: result.document.documentLabel,
      },
    });
    revalidateServicePartnerPaths(result.servicePartner.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=document-deleted`);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      redirect(withErrorCode(redirectTo, "document-not-found"));
    }
    throw error;
  }
}
