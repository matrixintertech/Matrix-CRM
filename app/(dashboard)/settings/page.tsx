import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { updateSettingsAction } from "@/features/settings/actions/settings.actions";
import { SettingsForm } from "@/features/settings/components/settings-form";
import { getSettingsPageData } from "@/features/settings/services/settings.service";
import { hasPermission } from "@/lib/auth/permissions";
import { redirectForbidden } from "@/lib/auth/access-control";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type SettingsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the settings values before saving.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "updated") {
    return "Settings updated successfully.";
  }
  return undefined;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await requirePermission("settings.read");
  const [params, canUpdate, pageData] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "settings.update"),
    getSettingsPageData(session),
  ]);

  if (!pageData) {
    redirectForbidden("/settings");
  }

  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  return (
    <section className="crm-page">
      <PageHeader
        title="Settings"
        description="Manage tenant-level application settings, OTP policy, and confirm current runtime controls."
      />

      <div>
        <Link href="/" className="crm-back-link">
          Back to dashboard
        </Link>
      </div>

      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      {!pageData.servicePartner ? (
        <EmptyState title="Settings unavailable" description="No active tenant scope was found for this session." />
      ) : (
        <SettingsForm
          action={updateSettingsAction}
          canUpdate={canUpdate}
          errorMessage={errorMessage}
          servicePartner={pageData.servicePartner}
          values={pageData.editable}
          system={pageData.system}
        />
      )}
    </section>
  );
}
