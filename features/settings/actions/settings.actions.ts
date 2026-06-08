"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";
import { updateTenantSettings } from "@/features/settings/services/settings.service";
import { settingsUpdateSchema } from "@/features/settings/validations";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

export async function updateSettingsAction(formData: FormData) {
  const session = await requirePermission("settings.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/settings");

  const parsed = settingsUpdateSchema.safeParse({
    timezone: getFormString(formData, "timezone"),
    otpExpirySeconds: getFormString(formData, "otpExpirySeconds"),
    otpMaxAttempts: getFormString(formData, "otpMaxAttempts"),
    otpResendCooldownSeconds: getFormString(formData, "otpResendCooldownSeconds"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "validation"));
  }

  const updated = await updateTenantSettings(session, parsed.data);

  await logActivity({
    action: "settings.update",
    module: "settings",
    entityType: "OTHER",
    entityId: updated.id,
    servicePartnerId: updated.id,
    message: "Tenant settings updated",
    metadata: parsed.data,
  });

  revalidatePath("/settings");
  redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=updated`);
}
