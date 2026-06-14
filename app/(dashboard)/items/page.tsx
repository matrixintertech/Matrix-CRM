import type { ReactNode } from "react";

import { deleteItemAction } from "@/features/items/actions/item.actions";
import {
  getItemOverview,
  listCategoriesForItemForm,
  listItemServicePartnersForForm,
  listItems,
  listSubcategoriesForItemForm,
  type ItemStockStatus,
} from "@/features/items/services/item.service";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr } from "@/lib/utils/format";

type ItemsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type ItemsResult = Awaited<ReturnType<typeof listItems>>;
type ItemRow = ItemsResult["items"][number];

const pageSizeOptions = [8, 10, 20];

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "created-all") {
    return "Item created for all service partners.";
  }
  if (code === "deleted") {
    return "Item deleted successfully.";
  }
  return undefined;
}

function toStatus(value?: string): ItemStockStatus | undefined {
  return value === "active" || value === "low_stock" || value === "out_of_stock" || value === "inactive" ? value : undefined;
}

function buildItemsHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/items?${query}` : "/items";
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

function getStatusTone(status: ItemStockStatus) {
  if (status === "active") {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === "low_stock") {
    return "bg-[#fff4e5] text-[#e7881d]";
  }
  if (status === "out_of_stock") {
    return "bg-[#fff1f1] text-[#ff4f5e]";
  }
  return "bg-[#edf3ff] text-[#6f82a4]";
}

function getStatusLabel(status: ItemStockStatus) {
  if (status === "active") {
    return "Active";
  }
  if (status === "low_stock") {
    return "Low Stock";
  }
  if (status === "out_of_stock") {
    return "Out of Stock";
  }
  return "Inactive";
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

function formatShortDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatRelativeUpdate(value: Date | null) {
  if (!value) {
    return "No recent updates";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Last updated: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last updated: ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Last updated: ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
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
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value.toLocaleString("en-IN")}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
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

function ItemPagination({
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
        <PrefetchLink href={buildItemsHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildItemsHref({ ...currentFilters, page: token })}
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
        <PrefetchLink href={buildItemsHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

function QuickActionCard({
  href,
  title,
  icon,
}: {
  href: string;
  title: string;
  icon: ReactNode;
}) {
  return (
    <PrefetchLink href={href} className="flex items-center gap-3 rounded-[18px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:border-[#d9e3ff] hover:bg-white">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-[#315cff] shadow-[0_8px_18px_rgba(49,92,255,0.10)]">{icon}</span>
      <span>{title}</span>
    </PrefetchLink>
  );
}

export default async function ItemsPage({ searchParams }: ItemsPageProps) {
  const session = await requirePermission("items.read");
  const [params, canCreate, canUpdate, canDelete, categories, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "items.create"),
    hasPermission(session, "items.update"),
    hasPermission(session, "items.delete"),
    listCategoriesForItemForm(session),
    listItemServicePartnersForForm(session),
  ]);

  const q = getStringParam(params, "q");
  const categoryId = getStringParam(params, "categoryId");
  const subcategoryId = getStringParam(params, "subcategoryId");
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const status = toStatus(getStringParam(params, "status"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 8;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [subcategories, result, overview] = await Promise.all([
    listSubcategoriesForItemForm(session, servicePartnerId ?? undefined, categoryId ?? undefined),
    listItems(session, { q, categoryId, subcategoryId, servicePartnerId, status, page, pageSize }),
    getItemOverview(session, { categoryId, subcategoryId, servicePartnerId }),
  ]);

  const currentFilters = {
    q,
    categoryId,
    subcategoryId,
    servicePartnerId,
    status,
    pageSize: result.pageSize,
  };
  const createItemHref = buildItemsHref({
    servicePartnerId,
    categoryId,
    subcategoryId,
  }).replace("/items", "/items/new");
  const createCategoryHref = servicePartnerId ? `/categories/new?servicePartnerId=${servicePartnerId}` : "/categories/new";
  const createSubcategoryHref = categoryId
    ? `/subcategories/new?servicePartnerId=${servicePartnerId ?? ""}&categoryId=${categoryId}`
    : servicePartnerId
      ? `/subcategories/new?servicePartnerId=${servicePartnerId}`
      : "/subcategories/new";
  const createUomHref = servicePartnerId ? `/uoms/new?servicePartnerId=${servicePartnerId}` : "/uoms/new";
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const stockDistributionTotal = overview.stockBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const categoryDistributionTotal = overview.categoryDistribution.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const stockGradient = buildDistributionGradient(overview.stockBreakdown);
  const categoryGradient = buildDistributionGradient(overview.categoryDistribution);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Items</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Manage inventory and service items across all companies.
          </p>
        </div>

        <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(overview.latestUpdatedAt)}</p>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
              <path d="M12 21V11" />
              <path d="m4 7 8 4 8-4" />
            </svg>
          }
          title="Total Items"
          value={overview.totalItems}
          subtitle="All items"
          trend={`${overview.activeItems ? Math.round((overview.activeItems / Math.max(overview.totalItems, 1)) * 100) : 0}% active`}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
              <path d="M12 21V11" />
              <path d="m4 7 8 4 8-4" />
            </svg>
          }
          title="Active Items"
          value={overview.activeItems}
          subtitle="Active in inventory"
          trend={`${overview.totalItems ? Math.round((overview.activeItems / overview.totalItems) * 100) : 0}%`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 5v8" />
              <path d="M8 9h8" />
              <path d="M5 8.5 12 3l7 5.5V19a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8.5Z" />
            </svg>
          }
          title="Low Stock Items"
          value={overview.lowStockItems}
          subtitle="Below threshold"
          trend={`${overview.totalItems ? Math.round((overview.lowStockItems / overview.totalItems) * 100) : 0}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8 8 8 8" />
            </svg>
          }
          title="Out of Stock Items"
          value={overview.outOfStockItems}
          subtitle="No stock available"
          trend={`${overview.totalItems ? Math.round((overview.outOfStockItems / overview.totalItems) * 100) : 0}%`}
          trendTone="bg-[#fff1f1] text-[#ff4f5e]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M5 9h14v10H5z" />
              <path d="M8 9V6h8v3" />
            </svg>
          }
          title="Categories"
          value={overview.categoriesCount}
          subtitle="All categories"
          trend={`${overview.popularCategories.length} tracked`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_420px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Inventory Overview</h2>
          </div>
          <div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
            <div className="rounded-[24px] border border-[#edf2fb] bg-[#fbfcff] p-4">
              <p className="text-sm font-semibold text-[#173260]">Stock Status</p>
              <div className="mt-4 flex items-center gap-5">
                <div className="relative grid h-36 w-36 shrink-0 place-items-center rounded-full" style={{ background: stockGradient }}>
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-3xl font-semibold leading-none text-[#11244a]">{overview.totalItems}</p>
                      <p className="mt-1 text-xs font-medium text-[#6f82a4]">Total Items</p>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {overview.stockBreakdown.map((entry) => (
                    <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-[#173260]">{entry.label}</span>
                      </div>
                      <span className="text-[#6f82a4]">
                        {entry.count} ({Math.round((entry.count / stockDistributionTotal) * 100)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-[#edf2fb] bg-[#fbfcff] p-4">
              <p className="text-sm font-semibold text-[#173260]">Category Distribution</p>
              <div className="mt-4 flex items-center gap-5">
                <div className="relative grid h-36 w-36 shrink-0 place-items-center rounded-full" style={{ background: categoryGradient }}>
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-3xl font-semibold leading-none text-[#11244a]">{overview.categoriesCount}</p>
                      <p className="mt-1 text-xs font-medium text-[#6f82a4]">Categories</p>
                    </div>
                  </div>
                </div>
                <div className="min-w-0 flex-1 space-y-3">
                  {overview.categoryDistribution.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="truncate text-[#173260]">{entry.name}</span>
                      </div>
                      <span className="text-[#6f82a4]">
                        {Math.round((entry.count / categoryDistributionTotal) * 100)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Quick Actions</h2>
          </div>
          <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
            {canCreate ? (
              <QuickActionCard
                href={createItemHref}
                title="Add Item"
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
                    <path d="M12 21V11" />
                    <path d="m4 7 8 4 8-4" />
                  </svg>
                }
              />
            ) : null}
            <QuickActionCard
              href={createCategoryHref}
              title="Add Category"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="4" y="4" width="6" height="6" rx="1.5" />
                  <rect x="14" y="4" width="6" height="6" rx="1.5" />
                  <rect x="4" y="14" width="6" height="6" rx="1.5" />
                  <rect x="14" y="14" width="6" height="6" rx="1.5" />
                </svg>
                }
              />
            <QuickActionCard
              href={createSubcategoryHref}
              title="Add Subcategory"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M5 6h14" />
                  <path d="M8 12h8" />
                  <path d="M11 18h2" />
                </svg>
              }
            />
            <QuickActionCard
              href={createUomHref}
              title="Add UOM"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M7 5h10" />
                  <path d="M10 5v14a2 2 0 0 0 4 0V5" />
                </svg>
              }
            />
            <QuickActionCard
              href="/rate-cards/new"
              title="Create Rate Card"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M5 7h14v10H5z" />
                  <path d="M8 11h8M8 15h5" />
                </svg>
              }
            />
            <QuickActionCard
              href="/vendors/new"
              title="Add Supplier"
              icon={
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="9" cy="8" r="3" />
                  <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
                  <path d="M17 8v6M14 11h6" />
                </svg>
              }
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_420px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Items Directory</h2>
          </div>

          <div className="border-b border-[#edf2fb] px-4 py-4 sm:px-5">
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
                    placeholder="Search items by code or name..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Category</span>
                <select
                  name="categoryId"
                  defaultValue={categoryId ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
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
                  <option value="">All</option>
                  <option value="active">Active</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Subcategory</span>
                <select
                  name="subcategoryId"
                  defaultValue={subcategoryId ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All</option>
                  {subcategories.map((subcategory) => (
                    <option key={subcategory.id} value={subcategory.id}>
                      {subcategory.name}
                    </option>
                  ))}
                </select>
              </label>

              {session.user.isSuperAdmin ? (
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Company</span>
                  <select
                    name="servicePartnerId"
                    defaultValue={servicePartnerId ?? ""}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  >
                    <option value="">All</option>
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

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff] transition hover:bg-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
                  </svg>
                  <span>Filters</span>
                </button>
                <PrefetchLink href="/items" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
              </div>
            </form>
          </div>

          {result.items.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No items found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi item record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Item Code</th>
                      <th className="px-4 py-4">Item Name</th>
                      <th className="px-4 py-4">Category</th>
                      <th className="px-4 py-4">Subcategory</th>
                      <th className="px-4 py-4">Unit</th>
                      <th className="px-4 py-4">Linked Company</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Stock</th>
                      <th className="px-4 py-4">Price</th>
                      <th className="px-4 py-4">Updated At</th>
                      <th className="px-5 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.items.map((item) => (
                      <tr key={item.id} className="transition hover:bg-[#fbfcff]">
                        <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{item.code}</td>
                        <td className="px-4 py-4">
                          <div>
                            <PrefetchLink href={`/items/${item.id}`} className="text-sm font-semibold text-[#122449] hover:text-[#315cff]">
                              {item.name}
                            </PrefetchLink>
                            <p className="mt-1 text-xs text-[#8092b2]">{item.metrics.inventoryLocations} inventory locations</p>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{item.category.name}</td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{item.subcategory?.name ?? "Unassigned"}</td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{item.uom ? `${item.uom.name} (${item.uom.symbol})` : item.unit}</td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{item.servicePartner.name}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(item.metrics.status)}`}>
                            {getStatusLabel(item.metrics.status)}
                          </span>
                        </td>
                        <td className={`px-4 py-4 text-sm font-semibold ${item.metrics.status === "out_of_stock" ? "text-[#ff4f5e]" : item.metrics.status === "low_stock" ? "text-[#e7881d]" : "text-[#1d9d57]"}`}>
                          {item.metrics.totalStockQty.toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{item.metrics.latestRate !== null ? formatCurrencyInr(item.metrics.latestRate) : "Pending"}</td>
                        <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDateTime(item.updatedAt)}</td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <PrefetchLink href={`/items/${item.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${item.name}`}>
                              <RowActionIcon kind="view" />
                            </PrefetchLink>
                            {canUpdate ? (
                              <PrefetchLink href={`/items/${item.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${item.name}`}>
                                <RowActionIcon kind="edit" />
                              </PrefetchLink>
                            ) : null}
                            {canDelete ? (
                              <form action={deleteItemAction.bind(null, item.id)}>
                                <input type="hidden" name="redirectTo" value="/items" />
                                <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] text-[#ff5a5a] transition hover:bg-[#fff0f0]" aria-label={`Delete ${item.name}`}>
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
                {result.items.map((item) => (
                  <article key={item.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{item.name}</p>
                        <p className="mt-1 truncate text-xs text-[#8092b2]">{item.code}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(item.metrics.status)}`}>
                        {getStatusLabel(item.metrics.status)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Category</p>
                        <p className="mt-1 text-sm text-[#16315f]">{item.category.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Subcategory</p>
                        <p className="mt-1 text-sm text-[#16315f]">{item.subcategory?.name ?? "Unassigned"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Unit</p>
                        <p className="mt-1 text-sm text-[#16315f]">{item.uom ? `${item.uom.name} (${item.uom.symbol})` : item.unit}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Company</p>
                        <p className="mt-1 text-sm text-[#16315f]">{item.servicePartner.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Stock</p>
                        <p className="mt-1 text-sm text-[#16315f]">{item.metrics.totalStockQty.toLocaleString("en-IN")}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Price</p>
                        <p className="mt-1 text-sm text-[#16315f]">{item.metrics.latestRate !== null ? formatCurrencyInr(item.metrics.latestRate) : "Pending"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Updated</p>
                        <p className="mt-1 text-sm text-[#16315f]">{formatShortDateTime(item.updatedAt)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <PrefetchLink href={`/items/${item.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                        <RowActionIcon kind="view" />
                        <span>View</span>
                      </PrefetchLink>
                      {canUpdate ? (
                        <PrefetchLink href={`/items/${item.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="edit" />
                          <span>Edit</span>
                        </PrefetchLink>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} items
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildItemsHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <ItemPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Alerts / Attention Needed</h2>
          </div>
          <div className="divide-y divide-[#edf2fb]">
            {[
              {
                label: "Low stock items",
                subtitle: "Items below minimum threshold",
                count: overview.lowStockItems,
                tone: "text-[#ff9a1a] bg-[#fff4e5]",
              },
              {
                label: "Inactive items",
                subtitle: "Items not active in inventory",
                count: overview.inactiveItems,
                tone: "text-[#5f8dff] bg-[#edf3ff]",
              },
              {
                label: "Pending updates",
                subtitle: "Items not refreshed in 30+ days",
                count: overview.pendingUpdates,
                tone: "text-[#875bff] bg-[#f3eaff]",
              },
              {
                label: "Missing prices",
                subtitle: "Items without rate card pricing",
                count: overview.missingPrices,
                tone: "text-[#ff8f1f] bg-[#fff4e5]",
              },
              {
                label: "Out-of-stock items",
                subtitle: "No stock available",
                count: overview.outOfStockItems,
                tone: "text-[#ff4f5e] bg-[#fff1f1]",
              },
            ].map((alert) => (
              <div key={alert.label} className="flex items-center gap-4 px-5 py-4">
                <div className={`grid h-11 w-11 place-items-center rounded-full ${alert.tone}`}>
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M12 8v4" />
                    <path d="M12 16h.01" />
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#122449]">{alert.label}</p>
                  <p className="mt-1 text-xs text-[#8092b2]">{alert.subtitle}</p>
                </div>
                <span className={`rounded-2xl px-3 py-1 text-sm font-semibold ${alert.tone}`}>{alert.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Popular Categories</h2>
          <PrefetchLink href="/categories" className="text-sm font-semibold text-[#315cff]">
            View all categories
          </PrefetchLink>
        </div>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
          {overview.popularCategories.map((category) => (
            <article key={category.id} className="rounded-[22px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${getAvatarTone(category.name)} text-sm font-semibold text-white`}>
                  {getInitials(category.name)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#122449]">{category.name}</p>
                  <p className="mt-1 text-xs text-[#8092b2]">{category.count} Items</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
