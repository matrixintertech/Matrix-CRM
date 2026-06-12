import { ClientStatus } from "@prisma/client";
import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import {
  getBranchOverview,
  listBranchFilterOptions,
  listBranches,
  listBranchServicePartnersForForm,
  listRecentBranches,
  listTopBranchCompanies,
} from "@/features/branches/services/branch.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";
import { formatDateTime } from "@/lib/utils/format";

type BranchesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type BranchesResult = Awaited<ReturnType<typeof listBranches>>;
type BranchRow = BranchesResult["branches"][number];

const pageSizeOptions = [10, 20, 25];

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Branch deleted successfully.";
  }
  return undefined;
}

function buildBranchesHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/branches?${query}` : "/branches";
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

function getInitials(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatBranchStatus(status: ClientStatus) {
  if (status === ClientStatus.ON_HOLD) {
    return "On Hold";
  }
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function getStatusTone(status: ClientStatus) {
  if (status === ClientStatus.ACTIVE) {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === ClientStatus.ON_HOLD) {
    return "bg-[#fff4e5] text-[#e7881d]";
  }
  return "bg-[#edf3ff] text-[#3f66ff]";
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function getBranchManager(branch: BranchRow) {
  return branch.primaryContact?.name?.trim() || branch.primaryContact?.email?.trim() || branch.primaryContact?.phone?.trim() || "Unassigned";
}

function getBranchManagerMeta(branch: BranchRow) {
  return branch.primaryContact?.designation?.trim() || branch.primaryContact?.email?.trim() || branch.primaryContact?.phone?.trim() || branch.servicePartner.name;
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

function ToolbarButton({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-sm font-semibold transition ${
        disabled
          ? "cursor-not-allowed border-[#e4e9f3] bg-[#fbfcff] text-[#9aa8bf]"
          : "border-[#dbe4f2] bg-white text-[#173260] hover:bg-[#f7f9fd]"
      }`}
    >
      {children}
    </button>
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
        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
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

function BranchPagination({
  page,
  totalPages,
  currentFilters,
}: {
  page: number;
  totalPages: number;
  currentFilters: Record<string, string | number | undefined>;
}) {
  const visiblePages = getPageTokens(page, totalPages);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <PrefetchLink href={buildBranchesHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildBranchesHref({ ...currentFilters, page: token })}
            className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
              token === page
                ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]"
                : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
            }`}
          >
            {token}
          </PrefetchLink>
        ) : (
          <span key={token} className="px-1 text-sm text-[#8ea0bf]">
            ...
          </span>
        )
      )}
      {page < totalPages ? (
        <PrefetchLink href={buildBranchesHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function BranchesPage({ searchParams }: BranchesPageProps) {
  const session = await requirePermission("branches.read");
  const [params, canCreate, canUpdate, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "branches.create"),
    hasPermission(session, "branches.update"),
    listBranchServicePartnersForForm(session),
  ]);

  const q = getStringParam(params, "q");
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const state = getStringParam(params, "state");
  const city = getStringParam(params, "city");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(ClientStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, filterOptions, recentBranches, topCompanies] = await Promise.all([
    listBranches(session, { q, servicePartnerId, status, state, city, page, pageSize }),
    getBranchOverview(session, { servicePartnerId, status, state, city }),
    listBranchFilterOptions(session, { servicePartnerId, status }),
    listRecentBranches(session, { servicePartnerId, status, state, city }),
    listTopBranchCompanies(session, { servicePartnerId, status, state, city }),
  ]);

  const currentFilters = {
    q,
    servicePartnerId,
    state,
    city,
    status,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const topCompanyMax = Math.max(...topCompanies.map((company) => company.count), 1);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Branches</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Manage branch offices across all companies and service partners.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex min-h-12 items-center rounded-2xl border border-[#dbe4ff] bg-[#f7f9ff] px-4 text-sm font-semibold text-[#5d72a7]">
            Import and export are hidden until branch file flows are implemented.
          </span>
          {canCreate ? (
            <PrefetchLink
              href="/branches/new"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>Add Branch</span>
            </PrefetchLink>
          ) : null}
        </div>
      </div>

      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M4 20h16" />
              <path d="M7 20V5l5-2 5 2v15" />
              <path d="M9 9h.01M12 9h.01M15 9h.01M9 13h.01M12 13h.01M15 13h.01" />
            </svg>
          }
          title="Total Branches"
          value={overview.totalBranches}
          subtitle="All branches"
          trend={`${overview.addedThisMonth} new`}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8.5 12 2.3 2.3 4.7-5.1" />
            </svg>
          }
          title="Active Branches"
          value={overview.activeBranches}
          subtitle="Linked to active clients"
          trend={`${overview.totalBranches ? Math.round((overview.activeBranches / overview.totalBranches) * 100) : 0}%`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          }
          title="Inactive Branches"
          value={overview.inactiveBranches}
          subtitle="Need follow-up"
          trend={`${overview.totalBranches ? Math.round((overview.inactiveBranches / overview.totalBranches) * 100) : 0}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="8" cy="9" r="3" />
              <circle cx="16" cy="9" r="3" />
              <path d="M3.5 19a5.5 5.5 0 0 1 9 0" />
              <path d="M11.5 19a5.5 5.5 0 0 1 9 0" />
            </svg>
          }
          title="Companies Covered"
          value={overview.companiesCovered}
          subtitle="With branch presence"
          trend={`${topCompanies.length} ranked`}
          trendTone="bg-[#edf3ff] text-[#3f66ff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 21s6-5.3 6-11a6 6 0 1 0-12 0c0 5.7 6 11 6 11Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          }
          title="Cities Covered"
          value={overview.citiesCovered}
          subtitle="Across regions"
          trend={`${filterOptions.cities.length} options`}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
      </div>

      <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
        <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_1fr_1fr_1fr_1fr_auto] xl:items-end">
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
                placeholder="Search branch name, code..."
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              />
            </span>
          </label>

          {session.user.isSuperAdmin ? (
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Company / Service Partner</span>
              <select
                name="servicePartnerId"
                defaultValue={servicePartnerId ?? ""}
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              >
                <option value="">All Companies</option>
                {servicePartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {getServicePartnerDisplayLabel(partner)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="hidden xl:block" />
          )}

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">State</span>
            <select
              name="state"
              defaultValue={state ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
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
            <select
              name="city"
              defaultValue={city ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Cities</option>
              {filterOptions.cities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Status</option>
              {Object.values(ClientStatus).map((value) => (
                <option key={value} value={value}>
                  {formatBranchStatus(value)}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
              Apply
            </button>
            <PrefetchLink href="/branches" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dbe4f2] bg-white px-5 text-sm font-semibold text-[#173260] transition hover:bg-[#f7f9fd]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
              </svg>
              <span>Reset Filters</span>
            </PrefetchLink>
          </div>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_340px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="flex flex-col gap-4 border-b border-[#edf2fb] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[#122449]">All Branches</h2>
            {result.total > 0 ? (
              <div className="flex flex-col gap-3 lg:items-end">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} branches
                </p>
                <BranchPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            ) : null}
          </div>

          {result.branches.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No branches found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi branch record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-6 py-4">Branch Code</th>
                      <th className="px-4 py-4">Branch Name</th>
                      <th className="px-4 py-4">Company / Partner</th>
                      <th className="px-4 py-4">Client Users</th>
                      <th className="px-4 py-4">City</th>
                      <th className="px-4 py-4">State</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Manager / Contact</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.branches.map((branch) => (
                      <tr key={branch.id} className="transition hover:bg-[#fbfcff]">
                        <td className="px-6 py-4 text-sm font-semibold text-[#122449]">{branch.code}</td>
                        <td className="px-4 py-4">
                          <div>
                            <PrefetchLink href={`/branches/${branch.id}`} className="text-sm font-semibold text-[#122449] hover:text-[#315cff]">
                              {branch.name}
                            </PrefetchLink>
                            <p className="mt-1 text-xs text-[#8a9ab8]">{branch._count.serviceRequests} service requests</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">
                          <div>
                            <p className="font-medium text-[#16315f]">{branch.client.name}</p>
                            <p className="mt-1 text-xs text-[#8a9ab8]">{branch.servicePartner.name}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{branch.client._count.clientUsers}</td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{branch.city ?? "-"}</td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{branch.state ?? "-"}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(branch.client.status)}`}>
                            {formatBranchStatus(branch.client.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(branch.client.code)} text-xs font-semibold text-white`}>
                              {getInitials(getBranchManager(branch))}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[#16315f]">{getBranchManager(branch)}</p>
                              <p className="truncate text-xs text-[#8a9ab8]">{getBranchManagerMeta(branch)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <PrefetchLink href={`/branches/${branch.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${branch.name}`}>
                              <RowActionIcon kind="view" />
                            </PrefetchLink>
                            {canUpdate ? (
                              <PrefetchLink href={`/branches/${branch.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${branch.name}`}>
                                <RowActionIcon kind="edit" />
                              </PrefetchLink>
                            ) : null}
                            <PrefetchLink href={`/branches/${branch.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`More details for ${branch.name}`}>
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
                {result.branches.map((branch) => (
                  <article key={branch.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{branch.name}</p>
                        <p className="mt-1 truncate text-xs text-[#8092b2]">{branch.code}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(branch.client.status)}`}>
                        {formatBranchStatus(branch.client.status)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Company</p>
                        <p className="mt-1 text-sm text-[#16315f]">{branch.client.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Partner</p>
                        <p className="mt-1 text-sm text-[#16315f]">{branch.servicePartner.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Client Users</p>
                        <p className="mt-1 text-sm text-[#16315f]">{branch.client._count.clientUsers}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Requests</p>
                        <p className="mt-1 text-sm text-[#16315f]">{branch._count.serviceRequests}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">City / State</p>
                        <p className="mt-1 text-sm text-[#16315f]">
                          {branch.city ?? "-"} / {branch.state ?? "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Manager</p>
                        <p className="mt-1 text-sm text-[#16315f]">{getBranchManager(branch)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <PrefetchLink href={`/branches/${branch.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                        <RowActionIcon kind="view" />
                        <span>View</span>
                      </PrefetchLink>
                      {canUpdate ? (
                        <PrefetchLink href={`/branches/${branch.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="edit" />
                          <span>Edit</span>
                        </PrefetchLink>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-sm text-[#7486a8]">
                  <span>Show</span>
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildBranchesHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                  <span>entries</span>
                </div>

                <BranchPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent Branches Added</h2>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {recentBranches.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#7486a8]">No recent branches available.</p>
              ) : (
                recentBranches.map((branch) => (
                  <PrefetchLink key={branch.id} href={`/branches/${branch.id}`} className="flex items-start gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                    <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(branch.client.code)} text-sm font-semibold text-white`}>
                      {getInitials(branch.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{branch.name}</p>
                      <p className="mt-1 truncate text-xs text-[#8092b2]">
                        {branch.client.name} - {branch.city ?? "Unknown city"}, {branch.state ?? "Unknown state"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-[#8a9ab8]">{formatShortDate(branch.createdAt)}</p>
                      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getStatusTone(branch.client.status)}`}>
                        {formatBranchStatus(branch.client.status)}
                      </span>
                    </div>
                  </PrefetchLink>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top Companies by Branch Count</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {topCompanies.length === 0 ? (
                <p className="text-sm text-[#7486a8]">No company ranking data available.</p>
              ) : (
                topCompanies.map((company, index) => (
                  <div key={company.id} className="grid grid-cols-[20px_minmax(0,1fr)_36px] items-center gap-3">
                    <span className="text-sm font-medium text-[#7e91b2]">{index + 1}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className={`grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(company.code)} text-[11px] font-semibold text-white`}>
                          {getInitials(company.name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-[#173260]">{company.name}</p>
                        </div>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-[#eef2fb]">
                        <div className="h-2 rounded-full bg-[#315cff]" style={{ width: `${Math.max((company.count / topCompanyMax) * 100, 12)}%` }} />
                      </div>
                    </div>
                    <span className="text-right text-sm text-[#6f82a4]">{company.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Branch Pulse</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-[22px] border border-[#edf2fb] bg-[#fbfcff] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Coverage</p>
                <p className="mt-2 text-2xl font-semibold text-[#122449]">{overview.companiesCovered} companies</p>
                <p className="mt-1 text-sm text-[#7082a6]">Spread across {overview.citiesCovered} cities in the current branch dataset.</p>
              </div>
              <div className="rounded-[22px] border border-[#edf2fb] bg-[#fbfcff] p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Latest update</p>
                <p className="mt-2 text-sm font-medium text-[#173260]">
                  {recentBranches[0] ? `${recentBranches[0].name} added on ${formatDateTime(recentBranches[0].createdAt)}` : "No recent branch activity."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
