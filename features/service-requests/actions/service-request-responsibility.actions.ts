"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updateServiceRequestResponsibilities } from "@/features/service-requests/services/service-request-responsibility.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { notifyServiceRequestResponsibilitiesUpdated } from "@/lib/notifications/notification.service";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

function revalidateServiceRequestPaths(serviceRequestId: string) {
  revalidatePath("/service-requests");
  revalidatePath(`/service-requests/${serviceRequestId}`);
}

export async function updateServiceRequestResponsibilitiesAction(serviceRequestId: string, formData: FormData) {
  const session = await requirePermission("service_requests.responsibility.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/service-requests/${serviceRequestId}`);

  try {
    const updated = await updateServiceRequestResponsibilities(session, serviceRequestId, {
      pmUserId: getFormString(formData, "pmUserId"),
      smUserId: getFormString(formData, "smUserId"),
      technicianUserId: getFormString(formData, "technicianUserId"),
    });

    await logActivity({
      action: "service_request.responsibility_update",
      module: "service_requests",
      entityType: "SERVICE_REQUEST",
      entityId: serviceRequestId,
      message: "Service request responsibility updated",
      metadata: {
        pmUserId: updated.snapshot.PM?.user.id ?? null,
        smUserId: updated.snapshot.SM?.user.id ?? null,
        technicianUserId: updated.snapshot.TECHNICIAN?.user.id ?? null,
      },
      servicePartnerId: updated.servicePartnerId,
    });
    try {
      await notifyServiceRequestResponsibilitiesUpdated(serviceRequestId, session.user.id);
    } catch (notificationError) {
      console.error("Service request responsibility notification failed", {
        serviceRequestId,
        reason: notificationError instanceof Error ? notificationError.message.slice(0, 200) : "unknown",
      });
    }

    revalidateServiceRequestPaths(serviceRequestId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=responsibility-updated`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("invalid") || lower.includes("tenant")) {
        redirect(withErrorCode(redirectTo, "responsibility-mismatch"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "responsibility-not-found"));
      }
    }
    throw error;
  }
}
