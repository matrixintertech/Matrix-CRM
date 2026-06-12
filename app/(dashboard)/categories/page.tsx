import type { ReactNode } from "react";

import { deleteCategoryAction } from "@/features/categories/actions/category.actions";
import {
  getCategoryOverview,
  listCategories,
  listCategoryServicePartnersForForm,
  listRecentCategories,
  type CategoryListStatus,
  type CategorySortKey,
} from "@/features/categories/services/category.service";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type CategoriesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type CategoriesResult = Awaited<ReturnType<typeof listCategories>>;
type CategoryRow = CategoriesResult["categories"][number];

const pageSizeOptions = [8, 10, 20];
const sortOptions: Array<{ value: CategorySortKey; label: string }> = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "created-desc", label: "Newest First" },
  { value: "updated-desc", label: "Recently Updated" },
];

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Category deleted successfully.";
  }
  return undefined;
}

function toCategoryStatus(value?: string): CategoryListStatus | undefined {
  return value === "active" || value === "inactive" ? value : undefined;
}

function toCategorySort(value?: string): CategorySortKey {
  return value === "name-asc" || value === "name-desc" || value === "updated-desc" || value === "created-desc" ? value : "name-asc";
}

function buildCategoriesHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/categories?${query}` : "/categories";
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

function getStatusTone(status: CategoryListStatus) {
  return status === "active" ? "bg-[#eaf8ef] text-[#1d9d57]" : "bg-[#fff4e5] text-[#e7881d]";
}

function getStatusLabel(status: CategoryListStatus) {
  return status === "active" ? "Active" : "Inactive";
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function buildDistributionGradient(entries: Array<{ count: number; color: string }>) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0) || 1;
  let cursor = 0;
  const slices = entries.map((entry) => {
    const start = cursor;
    cursor += (entry.count / total) * 360;
    return `${entry.color} ${start}deg ${cursor}deg`;
  });
  return `conic-gradient(${slices.join(", ")})`;
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

function RowActionIcon({ kind }: { kind: "view" | "edit" | "delete" }) {
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
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
    </svg>
  );
}

function CategoryPagination({
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
        <PrefetchLink href={buildCategoriesHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildCategoriesHref({ ...currentFilters, page: token })}
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
        <PrefetchLink href={buildCategoriesHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function CategoriesPage({ searchParams }: CategoriesPageProps) {
  const session = await requirePermission("categories.read");
  const [params, canCreate, canUpdate, canDelete, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "categories.create"),
    hasPermission(session, "categories.update"),
    hasPermission(session, "categories.delete"),
    listCategoryServicePartnersForForm(session),
  ]);

  const q = getStringParam(params, "q");
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const status = toCategoryStatus(getStringParam(params, "status"));
  const sort = toCategorySort(getStringParam(params, "sort"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 8;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, recentCategories] = await Promise.all([
    listCategories(session, { q, servicePartnerId, status, sort, page, pageSize }),
    getCategoryOverview(session, { servicePartnerId }),
    listRecentCategories(session, { servicePartnerId, status }),
  ]);

  const currentFilters = {
    q,
    servicePartnerId,
    status,
    sort,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const distributionTotal = overview.distribution.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const distributionGradient = buildDistributionGradient(overview.distribution);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-[20px] border border-white/70 bg-gradient-to-br from-[#f7f4ff] to-[#edefff] text-[#5a55ff] shadow-[0_18px_36px_rgba(70,88,255,0.10)]">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="4" y="4" width="6" height="6" rx="1.5" />
              <rect x="14" y="4" width="6" height="6" rx="1.5" />
              <rect x="4" y="14" width="6" height="6" rx="1.5" />
              <rect x="14" y="14" width="6" height="6" rx="1.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Category Management</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
              Manage categories used across items, services, and procurement records.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canCreate ? (
            <PrefetchLink
              href="/categories/new"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>Add Category</span>
            </PrefetchLink>
          ) : null}
          <span className="inline-flex min-h-12 items-center rounded-2xl border border-[#dbe4ff] bg-[#f7f9ff] px-4 text-sm font-semibold text-[#5d72a7]">
            Export appears here once category export is backed by a real route.
          </span>
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 3 4 7l8 4 8-4-8-4Z" />
              <path d="m4 12 8 4 8-4" />
              <path d="m4 17 8 4 8-4" />
            </svg>
          }
          title="Total Categories"
          value={overview.totalCategories}
          subtitle="All categories"
          trend={`${overview.addedThisMonth} new`}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 3 5 6v5c0 4.3 2.7 7.4 7 8.9 4.3-1.5 7-4.6 7-8.9V6l-7-3Z" />
              <path d="m9.5 12 2 2 3.8-4" />
            </svg>
          }
          title="Active Categories"
          value={overview.activeCategories}
          subtitle="With active items"
          trend={`${overview.totalCategories ? Math.round((overview.activeCategories / overview.totalCategories) * 100) : 0}%`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M8 8l8 8" />
            </svg>
          }
          title="Inactive Categories"
          value={overview.inactiveCategories}
          subtitle="No active items linked"
          trend={`${overview.totalCategories ? Math.round((overview.inactiveCategories / overview.totalCategories) * 100) : 0}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="10" y="3" width="4" height="5" rx="1" />
              <rect x="4" y="16" width="4" height="5" rx="1" />
              <rect x="10" y="16" width="4" height="5" rx="1" />
              <rect x="16" y="16" width="4" height="5" rx="1" />
              <path d="M12 8v4M6 16v-2h12v2" />
            </svg>
          }
          title="Linked Items"
          value={overview.totalItems}
          subtitle="Across all categories"
          trend={`${overview.totalCategories ? Math.round(overview.totalItems / overview.totalCategories) : 0} avg/category`}
          trendTone="bg-[#edf3ff] text-[#3f66ff]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_340px]">
        <div className="space-y-5">
          <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_1fr_1fr_1fr_auto] xl:items-end">
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
                    placeholder="Search categories..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
                <select
                  name="status"
                  defaultValue={status ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              {session.user.isSuperAdmin ? (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Service Partner</span>
                  <select
                    name="servicePartnerId"
                    defaultValue={servicePartnerId ?? ""}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  >
                    <option value="">All Partners</option>
                    {servicePartners.map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="hidden xl:block" />
              )}

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Sort By</span>
                <select
                  name="sort"
                  defaultValue={sort}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                  Apply
                </button>
                <PrefetchLink href="/categories" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dbe4f2] bg-white px-5 text-sm font-semibold text-[#173260] transition hover:bg-[#f7f9fd]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
              </div>
            </form>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex flex-col gap-4 border-b border-[#edf2fb] px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
              <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[#122449]">All Categories</h2>
              {result.total > 0 ? (
                <div className="flex flex-col gap-3 lg:items-end">
                  <p className="text-sm text-[#7486a8]">
                    Showing {showingFrom} to {showingTo} of {result.total} categories
                  </p>
                  <CategoryPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
                </div>
              ) : null}
            </div>

            {result.categories.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[#122449]">No categories found</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                  Current filters ke hisab se koi category record nahi mila. Search ya filters reset karke dobara check karein.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden overflow-x-auto lg:block">
                  <table className="min-w-full text-left">
                    <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                      <tr>
                        <th className="px-6 py-4">Category Name</th>
                        <th className="px-4 py-4">Service Partner</th>
                        <th className="px-4 py-4">Linked Items</th>
                        <th className="px-4 py-4">Active Items</th>
                        <th className="px-4 py-4">Status</th>
                        <th className="px-4 py-4">Created On</th>
                        <th className="px-4 py-4">Updated On</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf2fb]">
                      {result.categories.map((category) => (
                        <tr key={category.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br ${getAvatarTone(category.code)} text-xs font-semibold text-white`}>
                                {getInitials(category.name)}
                              </div>
                              <div className="min-w-0">
                                <PrefetchLink href={`/categories/${category.id}`} className="truncate text-sm font-semibold text-[#122449] hover:text-[#315cff]">
                                  {category.name}
                                </PrefetchLink>
                                <p className="truncate text-xs text-[#8092b2]">{category.code}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">
                            <div>
                              <p className="font-medium text-[#16315f]">{category.servicePartner.name}</p>
                              <p className="mt-1 text-xs text-[#8a9ab8]">{category.servicePartner.code}</p>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{category.stats.totalItems}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{category.stats.activeItems}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(category.stats.status)}`}>
                              {getStatusLabel(category.stats.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDate(category.createdAt)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDate(category.updatedAt)}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={`/categories/${category.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${category.name}`}>
                                <RowActionIcon kind="view" />
                              </PrefetchLink>
                              {canUpdate ? (
                                <PrefetchLink href={`/categories/${category.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${category.name}`}>
                                  <RowActionIcon kind="edit" />
                                </PrefetchLink>
                              ) : null}
                              {canDelete ? (
                                <form action={deleteCategoryAction.bind(null, category.id)}>
                                  <input type="hidden" name="redirectTo" value="/categories" />
                                  <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] text-[#ff5a5a] transition hover:bg-[#fff0f0]" aria-label={`Delete ${category.name}`}>
                                    <RowActionIcon kind="delete" />
                                  </button>
                                </form>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-4 p-4 lg:hidden">
                  {result.categories.map((category) => (
                    <article key={category.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{category.name}</p>
                          <p className="mt-1 truncate text-xs text-[#8092b2]">{category.code}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(category.stats.status)}`}>
                          {getStatusLabel(category.stats.status)}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Partner</p>
                          <p className="mt-1 text-sm text-[#16315f]">{category.servicePartner.name}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Linked Items</p>
                          <p className="mt-1 text-sm text-[#16315f]">{category.stats.totalItems}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Active Items</p>
                          <p className="mt-1 text-sm text-[#16315f]">{category.stats.activeItems}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Updated</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatShortDate(category.updatedAt)}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <PrefetchLink href={`/categories/${category.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="view" />
                          <span>View</span>
                        </PrefetchLink>
                        {canUpdate ? (
                          <PrefetchLink href={`/categories/${category.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
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
                        href={buildCategoriesHref({ ...currentFilters, page: 1, pageSize: size })}
                        className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                          size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                        }`}
                      >
                        {size}
                      </PrefetchLink>
                    ))}
                    <span>entries</span>
                  </div>

                  <CategoryPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Category Distribution</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: distributionGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[2rem] font-semibold leading-none text-[#11244a]">{overview.totalCategories}</p>
                      <p className="mt-2 text-sm font-medium text-[#6f82a4]">Total</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {overview.distribution.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-[#173260]">{entry.label}</span>
                    </div>
                    <span className="text-[#6f82a4]">
                      {entry.count} ({Math.round((entry.count / distributionTotal) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recently Added Categories</h2>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {recentCategories.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#7486a8]">No recent categories available.</p>
              ) : (
                recentCategories.map((category) => (
                  <PrefetchLink key={category.id} href={`/categories/${category.id}`} className="flex items-start gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                    <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(category.code)} text-sm font-semibold text-white`}>
                      {getInitials(category.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{category.name}</p>
                      <p className="mt-1 truncate text-xs text-[#8092b2]">
                        Partner: {category.servicePartner.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-[#8a9ab8]">{formatShortDate(category.createdAt)}</p>
                      <p className="mt-2 text-xs text-[#8092b2]">{category.stats.totalItems} items</p>
                    </div>
                  </PrefetchLink>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Admin Tips</h2>
            </div>
            <div className="space-y-3 px-5 py-5 text-sm text-[#173260]">
              <div className="flex items-start gap-3">
                <span className="mt-1 block h-2.5 w-2.5 rounded-full bg-[#ffb24d]" />
                <p>Keep category names short and reusable so item mapping stays consistent.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 block h-2.5 w-2.5 rounded-full bg-[#5f8dff]" />
                <p>Inactive categories currently have no active items linked, so they are safer candidates for cleanup.</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-1 block h-2.5 w-2.5 rounded-full bg-[#5bc878]" />
                <p>Review high-density categories regularly to avoid oversized catch-all buckets.</p>
              </div>
              <div className="border-t border-[#edf2fb] pt-3">
                <PrefetchLink href="/categories/new" className="text-sm font-semibold text-[#315cff]">
                  Learn more about category management {"->"}
                </PrefetchLink>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
