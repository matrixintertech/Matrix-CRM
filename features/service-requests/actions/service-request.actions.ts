"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createServiceRequest,
  getServicePartnerIdForServiceRequestWrite,
  getServiceRequestById,
  softDeleteServiceRequest,
  updateServiceRequest,
  updateServiceRequestStatus,
} from "@/features/service-requests/services/service-request.service";
import { serviceRequestStatusSchema, serviceRequestUpsertSchema } from "@/features/service-requests/validations";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireTenantAccess } from "@/lib/auth/tenant";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function parseServiceRequestInput(formData: FormData) {
  return serviceRequestUpsertSchema.safeParse({
    servicePartnerId: getFormString(formData, "servicePartnerId"),
    serviceNumber: getFormString(formData, "serviceNumber"),
    clientId: getFormString(formData, "clientId"),
    branchId: getFormString(formData, "branchId"),
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    serviceType: getFormString(formData, "serviceType"),
    status: getFormString(formData, "status"),
    requestedAt: getFormString(formData, "requestedAt"),
    targetDate: getFormString(formData, "targetDate"),
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTenantMismatchError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes("mismatch");
}

function isNotFoundLinkError(error: unknown) {
  return error instanceof Error && (error.message.includes("Client not found") || error.message.includes("Branch not found"));
}

function revalidateServiceRequestPaths(serviceRequestId: string) {
  revalidatePath("/service-requests");
  revalidatePath(`/service-requests/${serviceRequestId}`);
}

export async function createServiceRequestAction(formData: FormData) {
  const session = await requirePermission("service_requests.create");
  const parsed = parseServiceRequestInput(formData);

  if (!parsed.success) {
    redirect("/service-requests/new?error=validation");
  }

  const servicePartnerId = getServicePartnerIdForServiceRequestWrite(session, parsed.data.servicePartnerId);
  if (!servicePartnerId) {
    redirect("/service-requests/new?error=service-partner");
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const serviceRequest = await createServiceRequest(session, parsed.data);
    await logActivity({
      action: "service_request.create",
      module: "service_requests",
      entityType: "SERVICE_REQUEST",
      entityId: serviceRequest.id,
      message: "Service request created",
      metadata: {
        serviceNumber: serviceRequest.serviceNumber,
        status: serviceRequest.status,
      },
      servicePartnerId: serviceRequest.servicePartnerId,
    });

    revalidatePath("/service-requests");
    redirect(`/service-requests/${serviceRequest.id}?success=created`);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      redirect("/service-requests/new?error=duplicate");
    }
    if (isTenantMismatchError(error)) {
      redirect("/service-requests/new?error=mismatch");
    }
    if (isNotFoundLinkError(error)) {
      redirect("/service-requests/new?error=not-found");
    }
    throw error;
  }
}

export async function updateServiceRequestAction(id: string, formData: FormData) {
  const session = await requirePermission("service_requests.update");
  const parsed = parseServiceRequestInput(formData);

  if (!parsed.success) {
    redirect(`/service-requests/${id}/edit?error=validation`);
  }

  const existing = await getServiceRequestById(session, id);
  if (!existing) {
    throw new Error("Service request not found.");
  }

  const servicePartnerId = getServicePartnerIdForServiceRequestWrite(
    session,
    parsed.data.servicePartnerId ?? existing.servicePartnerId
  );
  if (!servicePartnerId) {
    redirect(`/service-requests/${id}/edit?error=service-partner`);
  }

  await requireTenantAccess(servicePartnerId);

  try {
    const serviceRequest = await updateServiceRequest(session, id, parsed.data);
    await logActivity({
      action: "service_request.update",
      module: "service_requests",
      entityType: "SERVICE_REQUEST",
      entityId: serviceRequest.id,
      message: "Service request updated",
      metadata: {
        serviceNumber: serviceRequest.serviceNumber,
      },
      servicePartnerId: serviceRequest.servicePartnerId,
    });
    revalidateServiceRequestPaths(serviceRequest.id);
    redirect(`/service-requests/${serviceRequest.id}?success=updated`);
  } catch (error) {
    if (isTenantMismatchError(error)) {
      redirect(`/service-requests/${id}/edit?error=mismatch`);
    }
    if (isNotFoundLinkError(error)) {
      redirect(`/service-requests/${id}/edit?error=not-found`);
    }
    throw error;
  }
}

export async function updateServiceRequestStatusAction(id: string, formData: FormData) {
  const session = await requirePermission("service_requests.update");
  const parsed = serviceRequestStatusSchema.safeParse({
    status: getFormString(formData, "status"),
    remarks: getFormString(formData, "remarks"),
  });

  if (!parsed.success) {
    redirect(`/service-requests/${id}?error=validation`);
  }

  const existing = await getServiceRequestById(session, id);
  if (!existing) {
    throw new Error("Service request not found.");
  }

  await requireTenantAccess(existing.servicePartnerId);

  const updated = await updateServiceRequestStatus(session, id, parsed.data);
  await logActivity({
    action: "service_request.status_change",
    module: "service_requests",
    entityType: "SERVICE_REQUEST",
    entityId: id,
    message: `Service request status changed from ${existing.status} to ${updated.status}`,
    metadata: {
      fromStatus: existing.status,
      toStatus: updated.status,
      remarks: parsed.data.remarks ?? null,
    },
    servicePartnerId: existing.servicePartnerId,
  });

  revalidateServiceRequestPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), `/service-requests/${id}`));
}

export async function deleteServiceRequestAction(id: string, formData: FormData) {
  const session = await requirePermission("service_requests.delete");
  const serviceRequest = await getServiceRequestById(session, id);

  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  await requireTenantAccess(serviceRequest.servicePartnerId);

  await softDeleteServiceRequest(id);
  await logActivity({
    action: "service_request.delete",
    module: "service_requests",
    entityType: "SERVICE_REQUEST",
    entityId: id,
    message: "Service request soft deleted",
    metadata: {
      serviceNumber: serviceRequest.serviceNumber,
    },
    servicePartnerId: serviceRequest.servicePartnerId,
  });

  revalidateServiceRequestPaths(id);
  redirect(getSafeRedirectPath(formData.get("redirectTo"), "/service-requests?success=deleted"));
}

