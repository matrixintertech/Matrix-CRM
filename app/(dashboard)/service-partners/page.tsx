import { ServicePartnerStatus } from "@prisma/client";
import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import {
  SERVICE_PARTNER_ONBOARDING_STAGES,
  canManageServicePartners,
  getServicePartnerOverview,
  listRecentServicePartners,
  listServicePartnerFilterOptions,
  listServicePartners,
} from "@/features/service-partners/services/service-partner.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime } from "@/lib/utils/format";

type ServicePartnersPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type ServicePartnersResult = Awaited<ReturnType<typeof listServicePartners>>;
type ServicePartnerRow = ServicePartnersResult["servicePartners"][number];

const onboardingLabels: Record<(typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number], string> = {
  completed: "Completed",
  verification: "Verification",
  documents: "Documents",
  review: "Review",
  not_started: "Not Started",
};

const stageColors: Record<(typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number], string> = {
  completed: "#17b15b",
  verification: "#f59a23",
  documents: "#3f82ff",
  review: "#ffc54d",
  not_started: "#9ca7bc",
};

const stageTone: Record<(typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number], string> = {
  completed: "bg-[#eaf8ef] text-[#1d9d57]",
  verification: "bg-[#fff4e6] text-[#ef8c1e]",
  documents: "bg-[#edf3ff] text-[#3f66ff]",
  review: "bg-[#fff7df] text-[#d9a11f]",
  not_started: "bg-[#f1f4f9] text-[#7d8daa]",
};

const pageSizeOptions = [7, 10, 20];

function getErrorMessage(code?: string) {
  if (code === "platform-protected") {
    return "The platform service partner cannot be deactivated or deleted.";
  }
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Service partner deleted successfully.";
  }
  return undefined;
}

function buildServicePartnersHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/service-partners?${query}` : "/service-partners";
}

function getPageTokens(page: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: Array<number | string> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    tokens.push("left-gap");
  }

  for (let current = start; current <= end; current += 1) {
    tokens.push(current);
  }

  if (end < totalPages - 1) {
    tokens.push("right-gap");
  }

  tokens.push(totalPages);
  return tokens;
}

function getAvatarTone(value: string) {
  const tones = [
    "from-[#5b5df8] to-[#4137d8]",
    "from-[#1f9bf0] to-[#1a77f2]",
    "from-[#11b981] to-[#149c67]",
    "from-[#f97316] to-[#ea580c]",
    "from-[#8b5cf6] to-[#6d28d9]",
  ];
  const total = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function getInitials(name: string) {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getStatusTone(status: ServicePartnerRow["status"]) {
  if (status === "ACTIVE") {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === "PENDING") {
    return "bg-[#edf3ff] text-[#3f66ff]";
  }
  if (status === "REJECTED") {
    return "bg-[#fff3df] text-[#ef8c1e]";
  }
  return "bg-[#ffe9ea] text-[#ef4e5e]";
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  trend,
  trendTone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  subtitle: string;
  trend: string;
  trendTone: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#e8edf7] bg-white/95 p-5 shadow-[0_16px_40px_rgba(23,52,110,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/70 bg-gradient-to-br from-[#f8f9ff] to-[#eef3ff] text-[#315cff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {icon}
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${trendTone}`}>{trend}</span>
      </div>
      <p className="mt-4 text-sm font-medium text-[#63759b]">{title}</p>
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function RowActionIcon({ kind }: { kind: "view" | "edit" | "more" }) {
  if (kind === "view") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 20h4l10-10-4-4L4 16v4Z" />
        <path d="m12 6 4 4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function buildDonutGradient(stageCounts: Awaited<ReturnType<typeof getServicePartnerOverview>>["stageCounts"]) {
  const total = stageCounts.reduce((sum, entry) => sum + entry.count, 0) || 1;
  let current = 0;
  const segments = stageCounts
    .filter((entry) => entry.count > 0)
    .map((entry) => {
      const start = Math.round((current / total) * 360);
      current += entry.count;
      const end = Math.round((current / total) * 360);
      return `${stageColors[entry.key]} ${start}deg ${end}deg`;
    });

  return `conic-gradient(${segments.join(", ")})`;
}

export default async function ServicePartnersPage({ searchParams }: ServicePartnersPageProps) {
  const session = await requirePermission("service_partners.read");
  const [params, canCreate, canUpdate] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "service_partners.create"),
    hasPermission(session, "service_partners.update"),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(ServicePartnerStatus).find((value) => value === statusParam);
  const state = getStringParam(params, "state");
  const city = getStringParam(params, "city");
  const onboardingStageParam = getStringParam(params, "onboardingStage");
  const onboardingStage = SERVICE_PARTNER_ONBOARDING_STAGES.includes(
    onboardingStageParam as (typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number]
  )
    ? (onboardingStageParam as (typeof SERVICE_PARTNER_ONBOARDING_STAGES)[number])
    : undefined;
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 7;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, filterOptions, recentCompanies] = await Promise.all([
    listServicePartners(session, { q, status, state, city, onboardingStage, page, pageSize }),
    getServicePartnerOverview(session, { status, state, city, onboardingStage }),
    listServicePartnerFilterOptions(session),
    listRecentServicePartners(session, { status, state, city, onboardingStage }),
  ]);

  const canManage = canManageServicePartners(session);
  const currentFilters = {
    q,
    status,
    state,
    city,
    onboardingStage,
    pageSize: result.pageSize,
  };
  const exportHref = `/api/service-partners/export?${new URLSearchParams(
    Object.entries(currentFilters).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value) {
        acc[key] = String(value);
      }
      return acc;
    }, {})
  ).toString()}`;
  const visiblePages = getPageTokens(result.page, result.totalPages);
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const donutGradient = buildDonutGradient(overview.stageCounts);
  const totalForProgress = overview.stageCounts.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const averageProgress =
    overview.stageCounts.reduce((sum, entry) => {
      const stageProgress = entry.key === "completed" ? 100 : entry.key === "verification" ? 75 : entry.key === "documents" ? 50 : entry.key === "review" ? 40 : 10;
      return sum + entry.count * stageProgress;
    }, 0) / totalForProgress;

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-[#e7ecf7] bg-[radial-gradient(circle_at_top_left,_rgba(85,96,255,0.10),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,251,255,0.98))] p-6 shadow-[0_18px_44px_rgba(16,40,88,0.06)] sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#cad6ff] to-transparent" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#7a8cad]">Organization</p>
            <h1 className="mt-3 text-[2.25rem] font-semibold tracking-[-0.05em] text-[#10244b]">Service Partners</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
              Manage companies, admins, onboarding, and organization-level operations.
            </p>
          </div>
          <div className="rounded-2xl border border-[#e6ebf6] bg-white/80 px-4 py-3 text-sm text-[#7082a6] shadow-[0_10px_24px_rgba(24,48,96,0.04)]">
            <div className="flex items-center gap-2 text-[#4c6494]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.7-7 9.1-4.2-1.4-7-4.7-7-9.1V6l7-2.5Z" />
              </svg>
              <span>{session.user.isSuperAdmin ? "Super Admin Workspace" : "Tenant Workspace"}</span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-7">
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 20h12" /><path d="M8 20V7l4-3 4 3v13" /><path d="M10 10h.01M14 10h.01M10 14h.01M14 14h.01" /></svg>}
            title="Total Companies"
            value={overview.totalCompanies}
            subtitle="All companies"
            trend={`${Math.round((overview.activeCompanies / Math.max(overview.totalCompanies, 1)) * 100)}% active`}
            trendTone="bg-[#ebf2ff] text-[#315cff]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="8" r="3" /><path d="M5 19a7 7 0 0 1 14 0" /></svg>}
            title="Active Companies"
            value={overview.activeCompanies}
            subtitle="Ready for operations"
            trend={`${overview.totalCompanies ? Math.round((overview.activeCompanies / overview.totalCompanies) * 100) : 0}% of total`}
            trendTone="bg-[#ebf6ef] text-[#1b9c56]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 8v4l2.5 2.5" /><circle cx="12" cy="12" r="8" /></svg>}
            title="Onboarding"
            value={overview.onboardingCompanies}
            subtitle="In progress"
            trend={`${overview.totalCompanies ? Math.round((overview.onboardingCompanies / overview.totalCompanies) * 100) : 0}%`}
            trendTone="bg-[#fff4e5] text-[#e7881d]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="8" /><path d="M12 8v5" /><path d="M12 16h.01" /></svg>}
            title="Inactive Companies"
            value={overview.inactiveCompanies}
            subtitle="Need attention"
            trend={`${overview.totalCompanies ? Math.round((overview.inactiveCompanies / overview.totalCompanies) * 100) : 0}%`}
            trendTone="bg-[#ffedf0] text-[#ef4e5e]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="9" cy="8" r="3" /><path d="M4 18a5 5 0 0 1 10 0" /><path d="M17 7v6M14 10h6" /></svg>}
            title="Company Admins"
            value={overview.companyAdmins}
            subtitle="Across all partners"
            trend={`${overview.totalCompanies ? Math.round(overview.companyAdmins / overview.totalCompanies) : 0} avg`}
            trendTone="bg-[#f3eaff] text-[#8747f4]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 20h16" /><path d="M7 20V6h10v14" /><path d="M10 10h.01M14 10h.01M10 14h.01M14 14h.01" /></svg>}
            title="Total Branches"
            value={overview.totalBranches}
            subtitle="Across all partners"
            trend={`${overview.totalCompanies ? Math.round(overview.totalBranches / overview.totalCompanies) : 0} avg`}
            trendTone="bg-[#e8fbf6] text-[#0da97c]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 9 0" /><path d="M11.5 19a5.5 5.5 0 0 1 9 0" /></svg>}
            title="Total Clients"
            value={overview.totalClients}
            subtitle="Across all partners"
            trend={`${overview.totalCompanies ? Math.round(overview.totalClients / overview.totalCompanies) : 0} avg`}
            trendTone="bg-[#ebf2ff] text-[#315cff]"
          />
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_340px]">
        <div className="space-y-5">
          <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_0.9fr_0.9fr_0.9fr_0.9fr_auto] xl:items-end">
              <input type="hidden" name="pageSize" value={result.pageSize} />

              <label className="block">
                <span className="relative block">
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search company name, legal name, admin..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
                <select name="status" defaultValue={status ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All Status</option>
                  {Object.values(ServicePartnerStatus).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">State</span>
                <select name="state" defaultValue={state ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All States</option>
                  {filterOptions.states.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">City</span>
                <select name="city" defaultValue={city ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All Cities</option>
                  {filterOptions.cities.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Onboarding Stage</span>
                <select
                  name="onboardingStage"
                  defaultValue={onboardingStage ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Stages</option>
                  {SERVICE_PARTNER_ONBOARDING_STAGES.map((value) => (
                    <option key={value} value={value}>
                      {onboardingLabels[value]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                  Filters
                </button>
                {canManage && canCreate ? (
                  <PrefetchLink href="/service-partners/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4v12M4 10h12" /></svg>
                    <span>Add Service Partner</span>
                  </PrefetchLink>
                ) : null}
                <a href={exportHref} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dde5f3] bg-white px-5 text-sm font-semibold text-[#315cff] transition hover:bg-[#f7f9ff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></svg>
                  <span>Export</span>
                </a>
              </div>
            </form>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full text-left">
                <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                  <tr>
                    <th className="px-6 py-4">Company Name</th>
                    <th className="px-4 py-4">Legal Name</th>
                    <th className="px-4 py-4">Company Admin</th>
                    <th className="px-4 py-4">State / City</th>
                    <th className="px-4 py-4">Clients</th>
                    <th className="px-4 py-4">Branches</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4">Onboarding Stage</th>
                    <th className="px-4 py-4">Created Date</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf2fb]">
                  {result.servicePartners.map((partner) => (
                    <tr key={partner.id} className="transition hover:bg-[#fbfcff]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(partner.code)} text-sm font-semibold text-white`}>
                            {getInitials(partner.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#122449]">{partner.name}</p>
                            <p className="truncate text-xs text-[#8092b2]">{partner.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{partner.legalName ?? "-"}</td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">
                        {partner.companyAdmin ? (
                          <div>
                            <p className="font-medium text-[#16315f]">{partner.companyAdmin.name ?? partner.companyAdmin.email ?? "Company Admin"}</p>
                            <p className="mt-1 text-xs text-[#8a9ab8]">{partner.companyAdmin.email ?? partner.companyAdmin.phone ?? "-"}</p>
                          </div>
                        ) : (
                          <span className="text-[#8a9ab8]">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">
                        <div>
                          <p>{partner.state ?? "-"}</p>
                          <p className="mt-1 text-xs text-[#8a9ab8]">{partner.city ?? "-"}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{partner._count.clients}</td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{partner._count.branches}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(partner.status)}`}>{partner.status}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div>
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${stageTone[partner.onboardingStage.key]}`}>{partner.onboardingStage.label}</span>
                          <p className="mt-1 text-xs text-[#8a9ab8]">{partner.onboardingStage.hint}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{formatDateTime(partner.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <PrefetchLink href={`/service-partners/${partner.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${partner.name}`}>
                            <RowActionIcon kind="view" />
                          </PrefetchLink>
                          {canManage && canUpdate ? (
                            <PrefetchLink href={`/service-partners/${partner.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${partner.name}`}>
                              <RowActionIcon kind="edit" />
                            </PrefetchLink>
                          ) : null}
                          <PrefetchLink href={`/service-partners/${partner.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`More actions for ${partner.name}`}>
                            <RowActionIcon kind="more" />
                          </PrefetchLink>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 p-4 lg:hidden">
              {result.servicePartners.map((partner) => (
                <article key={partner.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(partner.code)} text-sm font-semibold text-white`}>
                        {getInitials(partner.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{partner.name}</p>
                        <p className="truncate text-xs text-[#8092b2]">{partner.code}</p>
                      </div>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(partner.status)}`}>{partner.status}</span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Admin</p><p className="mt-1 text-sm text-[#16315f]">{partner.companyAdmin?.name ?? partner.companyAdmin?.email ?? "Unassigned"}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">State / City</p><p className="mt-1 text-sm text-[#16315f]">{partner.state ?? "-"} / {partner.city ?? "-"}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Clients</p><p className="mt-1 text-sm text-[#16315f]">{partner._count.clients}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Branches</p><p className="mt-1 text-sm text-[#16315f]">{partner._count.branches}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Stage</p><p className="mt-1 text-sm text-[#16315f]">{partner.onboardingStage.label}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Created</p><p className="mt-1 text-sm text-[#16315f]">{formatDateTime(partner.createdAt)}</p></div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <PrefetchLink href={`/service-partners/${partner.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                      <RowActionIcon kind="view" />
                      <span>View</span>
                    </PrefetchLink>
                    {canManage && canUpdate ? (
                      <PrefetchLink href={`/service-partners/${partner.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                        <RowActionIcon kind="edit" />
                        <span>Edit</span>
                      </PrefetchLink>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {result.servicePartners.length === 0 ? (
              <div className="border-t border-[#edf2fb] px-6 py-16 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[#122449]">No service partners found</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">Current filters ke hisab se koi company record nahi mila. Search ya dropdown filters reset karke dobara check karein.</p>
              </div>
            ) : null}

            {result.servicePartners.length > 0 ? (
              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">Showing {showingFrom} to {showingTo} of {result.total} companies</p>

                <div className="flex flex-wrap items-center gap-2">
                  {result.page > 1 ? (
                    <PrefetchLink href={buildServicePartnersHref({ ...currentFilters, page: result.page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6" /></svg>
                    </PrefetchLink>
                  ) : null}
                  {visiblePages.map((token) =>
                    typeof token === "number" ? (
                      <PrefetchLink
                        key={token}
                        href={buildServicePartnersHref({ ...currentFilters, page: token })}
                        className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
                          token === result.page ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]" : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
                        }`}
                      >
                        {token}
                      </PrefetchLink>
                    ) : (
                      <span key={token} className="px-1 text-sm text-[#8ea0bf]">...</span>
                    )
                  )}
                  {result.page < result.totalPages ? (
                    <PrefetchLink href={buildServicePartnersHref({ ...currentFilters, page: result.page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
                    </PrefetchLink>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <PrefetchLink href="/service-partners" className="rounded-xl border border-[#dfe6f2] px-3 py-2 text-sm font-semibold text-[#6f82a4] transition hover:bg-[#f8faff]">Reset</PrefetchLink>
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildServicePartnersHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size} / page
                    </PrefetchLink>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <div>
                <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Onboarding Progress</h2>
                <p className="mt-1 text-sm text-[#7082a6]">Current company setup pipeline.</p>
              </div>
            </div>

            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: donutGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[2rem] font-semibold leading-none text-[#11244a]">{overview.onboardingCompanies}</p>
                      <p className="mt-2 text-sm font-medium text-[#6f82a4]">In Progress</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {overview.stageCounts.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stageColors[entry.key] }} />
                      <span className="text-[#173260]">{onboardingLabels[entry.key]}</span>
                    </div>
                    <span className="text-[#6f82a4]">
                      {entry.count} ({Math.round((entry.count / totalForProgress) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-[#edf2fb] px-5 py-4 text-sm text-[#66799d]">Avg. setup score: {Math.round(averageProgress)}%</div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recently Added Companies</h2>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {recentCompanies.map((partner) => (
                <PrefetchLink key={partner.id} href={`/service-partners/${partner.id}`} className="flex items-start gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                  <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(partner.code)} text-sm font-semibold text-white`}>
                    {getInitials(partner.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#122449]">{partner.name}</p>
                    <p className="mt-1 text-xs text-[#8092b2]">Added on {formatDateTime(partner.createdAt)}</p>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${stageTone[partner.onboardingStage.key]}`}>{partner.onboardingStage.label}</span>
                </PrefetchLink>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Quick Actions</h2>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <PrefetchLink href={canManage && canCreate ? "/service-partners/new" : "/service-partners"} className="inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f3] px-4 py-3 text-sm font-semibold text-[#23416f] transition hover:bg-[#f8faff]">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#eef2ff] text-[#315cff]">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4v12M4 10h12" /></svg>
                </span>
                <span>Add Service Partner</span>
              </PrefetchLink>
              <PrefetchLink href="/users" className="inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f3] px-4 py-3 text-sm font-semibold text-[#23416f] transition hover:bg-[#f8faff]">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f5ebff] text-[#8747f4]">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="7" r="2.5" /><path d="M3.5 16a4.5 4.5 0 0 1 9 0" /><path d="M15 6v8M11 10h8" /></svg>
                </span>
                <span>Invite Company Admin</span>
              </PrefetchLink>
              <PrefetchLink href="/clients" className="inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f3] px-4 py-3 text-sm font-semibold text-[#23416f] transition hover:bg-[#f8faff]">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf8ef] text-[#1b9c56]">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="7" cy="7" r="2.5" /><circle cx="13.5" cy="8" r="2" /><path d="M2.5 16a4.5 4.5 0 0 1 9 0" /></svg>
                </span>
                <span>Open Clients</span>
              </PrefetchLink>
              <PrefetchLink href="/settings" className="inline-flex items-center gap-3 rounded-2xl border border-[#e2e8f3] px-4 py-3 text-sm font-semibold text-[#23416f] transition hover:bg-[#f8faff]">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fff4e5] text-[#e7881d]">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 3.5a2 2 0 0 1 2 2v.2a1.8 1.8 0 0 0 1.1 1.6 1.8 1.8 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.8 1.8 0 0 0-.3 1.9A1.8 1.8 0 0 0 18.5 13H18a2 2 0 1 1 0 4h-.2a1.8 1.8 0 0 0-1.6 1.1 1.8 1.8 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-1.9-.3 1.8 1.8 0 0 0-1.1 1.6v.2a2 2 0 1 1-4 0V19a1.8 1.8 0 0 0-1.1-1.6 1.8 1.8 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.8 1.8 0 0 0 .3-1.9A1.8 1.8 0 0 0 2 13.2H1.8a2 2 0 1 1 0-4H2a1.8 1.8 0 0 0 1.6-1.1 1.8 1.8 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.8 1.8 0 0 0 1.9.3A1.8 1.8 0 0 0 9 5.7V5.5a2 2 0 0 1 1-2Z" /></svg>
                </span>
                <span>Onboarding Settings</span>
              </PrefetchLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
