import type { ReactNode } from "react";

import { EmptyState } from "@/components/admin/empty-state";
import { PrefetchLink } from "@/components/admin/prefetch-link";
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

function formatStorage(bytes: number) {
  if (bytes <= 0) {
    return "0 MB";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const rounded = unitIndex === 0 ? size.toFixed(0) : size < 10 ? size.toFixed(1) : size.toFixed(0);
  return `${rounded} ${units[unitIndex]}`;
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  iconTone,
  iconBg,
  valueTone = "text-[#10244b]",
}: {
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
  iconTone: string;
  iconBg: string;
  valueTone?: string;
}) {
  return (
    <article className="rounded-[22px] border border-[#e8edf7] bg-white px-5 py-5 shadow-[0_14px_30px_rgba(22,49,100,0.05)]">
      <div className="flex items-start gap-4">
        <div className={`grid h-12 w-12 place-items-center rounded-2xl ${iconBg} ${iconTone}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#66789f]">{title}</p>
          <p className={`mt-2 text-[1.85rem] font-semibold leading-none tracking-[-0.05em] ${valueTone}`}>{value}</p>
          <p className="mt-3 text-sm text-[#93a2bd]">{subtitle}</p>
        </div>
      </div>
    </article>
  );
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
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Settings</h1>
          <p className="mt-2 text-sm text-[#7082a6] sm:text-base">Manage tenant-safe platform settings, OTP controls, and runtime health indicators.</p>
        </div>
        <PrefetchLink
          href="/activity-log"
          className="inline-flex h-12 items-center justify-center gap-2 self-start rounded-2xl border border-[#e3e9f4] bg-white px-5 text-sm font-semibold text-[#274c9e] transition hover:bg-[#f8fbff]"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M12 8v4l3 2" />
            <circle cx="12" cy="12" r="8" />
          </svg>
          <span>View Activity Log</span>
        </PrefetchLink>
      </div>

      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      {!pageData.servicePartner ? (
        <EmptyState title="Settings unavailable" description="No active tenant scope was found for this session." />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <StatCard
              title="Platform Name"
              value={pageData.servicePartner.name}
              subtitle={pageData.servicePartner.code}
              iconBg="bg-[#f2f4ff]"
              iconTone="text-[#5b46ff]"
              icon={
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M4 20h16" />
                  <path d="M7 20V5l5-2 5 2v15" />
                  <path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01" />
                </svg>
              }
            />
            <StatCard
              title="Users"
              value={pageData.overview.userCount.toLocaleString("en-IN")}
              subtitle="Total users"
              iconBg="bg-[#eef5ff]"
              iconTone="text-[#2f7df6]"
              icon={
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
                  <circle cx="17" cy="8.5" r="2.5" />
                </svg>
              }
            />
            <StatCard
              title="Roles"
              value={pageData.overview.roleCount.toLocaleString("en-IN")}
              subtitle="Total roles"
              iconBg="bg-[#ecfbf2]"
              iconTone="text-[#18a957]"
              icon={
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="m8.5 12.2 2.4 2.4 4.6-5" />
                  <circle cx="12" cy="12" r="8" />
                </svg>
              }
            />
            <StatCard
              title="Permissions"
              value={pageData.overview.permissionCount.toLocaleString("en-IN")}
              subtitle="Total permissions"
              iconBg="bg-[#fff4e8]"
              iconTone="text-[#ff8a1f]"
              icon={
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="7" y="10" width="10" height="9" rx="2.5" />
                  <path d="M9.5 10V8a2.5 2.5 0 0 1 5 0v2" />
                </svg>
              }
            />
            <StatCard
              title="Storage Usage"
              value={formatStorage(pageData.overview.storageUsedBytes)}
              subtitle={`${pageData.system.storageDriver} storage`}
              iconBg="bg-[#f3ebff]"
              iconTone="text-[#8f4cff]"
              icon={
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M12 4v8l5 3" />
                  <circle cx="12" cy="12" r="8" />
                </svg>
              }
            />
            <StatCard
              title="Email Status"
              value={pageData.system.smtpConfigured ? "Configured" : "Offline"}
              subtitle={`${pageData.system.otpDeliveryChannel.toUpperCase()} delivery`}
              iconBg="bg-[#eef6ff]"
              iconTone="text-[#2f7df6]"
              valueTone={pageData.system.smtpConfigured ? "text-[#18a957]" : "text-[#ff4f5e]"}
              icon={
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="4" y="6" width="16" height="12" rx="2.5" />
                  <path d="m5.5 8 6.5 5 6.5-5" />
                </svg>
              }
            />
          </div>

          <SettingsForm
            action={updateSettingsAction}
            canUpdate={canUpdate}
            errorMessage={errorMessage}
            servicePartner={pageData.servicePartner}
            values={pageData.editable}
            system={pageData.system}
          />
        </>
      )}
    </section>
  );
}
