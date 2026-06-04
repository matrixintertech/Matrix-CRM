"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  approveEmailChangeRequest,
  createEmailChangeRequest,
  rejectEmailChangeRequest,
  sendEmailChangeVerificationOtp,
  verifyEmailChangeRequest,
} from "@/features/users/services/email-change.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { requireAuth } from "@/lib/auth/session";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

export async function requestEmailChangeAction(formData: FormData) {
  const session = await requirePermission("profile.email_change.request");
  const newEmail = getFormString(formData, "newEmail");

  if (!newEmail) {
    redirect("/profile?error=email-change-validation");
  }

  try {
    const request = await createEmailChangeRequest(session, newEmail);
    await logActivity({
      action: "email_change.requested",
      module: "email_change_requests",
      entityType: "EMAIL_CHANGE_REQUEST",
      entityId: request.id,
      message: "Email change requested",
      metadata: {
        newEmail: request.newEmail,
      },
      servicePartnerId: request.servicePartnerId,
    });
    revalidatePath("/profile");
    revalidatePath("/email-change-requests");
    redirect("/profile?success=email-change-requested");
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("already in use")) {
      redirect("/profile?error=email-change-duplicate");
    }
    if (message.includes("pending")) {
      redirect("/profile?error=email-change-pending");
    }
    redirect("/profile?error=email-change-validation");
  }
}

export async function sendEmailChangeOtpAction(formData: FormData) {
  const session = await requireAuth();
  const requestId = getFormString(formData, "requestId");

  if (!requestId) {
    redirect("/profile?error=email-change-otp");
  }

  try {
    const request = await sendEmailChangeVerificationOtp(session, requestId);
    await logActivity({
      action: "email_change.otp_sent",
      module: "email_change_requests",
      entityType: "EMAIL_CHANGE_REQUEST",
      entityId: request.id,
      message: "Email change OTP sent",
      servicePartnerId: request.servicePartnerId,
    });
    revalidatePath("/profile");
    redirect("/profile?success=email-change-otp-sent");
  } catch {
    redirect("/profile?error=email-change-otp");
  }
}

export async function verifyEmailChangeAction(formData: FormData) {
  const session = await requireAuth();
  const requestId = getFormString(formData, "requestId");
  const code = getFormString(formData, "code");

  if (!requestId || !code) {
    redirect("/profile?error=email-change-verify");
  }

  try {
    const request = await verifyEmailChangeRequest(session, requestId, code);
    await logActivity({
      action: "email_change.verified",
      module: "email_change_requests",
      entityType: "EMAIL_CHANGE_REQUEST",
      entityId: request.id,
      message: "Email change verified and applied",
      servicePartnerId: request.servicePartnerId,
    });
    revalidatePath("/profile");
    revalidatePath("/users");
    redirect("/profile?success=email-change-verified");
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("expired")) {
      redirect("/profile?error=email-change-expired");
    }
    redirect("/profile?error=email-change-verify");
  }
}

export async function approveEmailChangeRequestAction(formData: FormData) {
  const session = await requirePermission("email_change_requests.approve");
  const requestId = getFormString(formData, "requestId");

  if (!requestId) {
    redirect("/email-change-requests?error=approval-validation");
  }

  try {
    const request = await approveEmailChangeRequest(session, requestId);
    await logActivity({
      action: "email_change.approved",
      module: "email_change_requests",
      entityType: "EMAIL_CHANGE_REQUEST",
      entityId: request.id,
      message: "Email change request approved",
      servicePartnerId: request.servicePartnerId,
    });
    revalidatePath("/email-change-requests");
    revalidatePath("/profile");
    redirect("/email-change-requests?success=approved");
  } catch {
    redirect("/email-change-requests?error=approval-validation");
  }
}

export async function rejectEmailChangeRequestAction(formData: FormData) {
  const session = await requirePermission("email_change_requests.reject");
  const requestId = getFormString(formData, "requestId");
  const rejectionReason = getFormString(formData, "rejectionReason");

  if (!requestId) {
    redirect("/email-change-requests?error=rejection-validation");
  }

  try {
    const request = await rejectEmailChangeRequest(session, requestId, rejectionReason);
    await logActivity({
      action: "email_change.rejected",
      module: "email_change_requests",
      entityType: "EMAIL_CHANGE_REQUEST",
      entityId: request.id,
      message: "Email change request rejected",
      metadata: {
        rejectionReason: request.rejectionReason,
      },
      servicePartnerId: request.servicePartnerId,
    });
    revalidatePath("/email-change-requests");
    revalidatePath("/profile");
    redirect("/email-change-requests?success=rejected");
  } catch {
    redirect("/email-change-requests?error=rejection-validation");
  }
}
