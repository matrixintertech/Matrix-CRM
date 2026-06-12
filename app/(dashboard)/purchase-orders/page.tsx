import type { ReactNode } from "react";

import { PurchaseOrderStatus } from "@prisma/client";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { deletePurchaseOrderAction } from "@/features/purchase-orders/actions/purchase-order.actions";
import {
  getPurchaseOrderOverview,
  listPurchaseOrderCategoryOptions,
  listPurchaseOrders,
  listVendorsForPurchaseOrderForm,
  type PurchaseOrderDateRange,
  type PurchaseOrderStatusGroup,
} from "@/features/purchase-orders/services/purchase-order.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr } from "@/lib/utils/format";

type PurchaseOrdersPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type PurchaseOrdersResult = Awaited<ReturnType<typeof listPurchaseOrders>>;
type PurchaseOrderRow = PurchaseOrdersResult["purchaseOrders"][number];

const pageSizeOptions = [10, 20, 25];

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  if (code === "not-found") {
    return "Purchase order record could not be found.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Purchase order deleted successfully.";
  }
  return undefined;
}

function toStatusGroup(value?: string): PurchaseOrderStatusGroup | undefined {
  return value === "open" || value === "partially_received" || value === "completed" || value === "cancelled" ? value : undefined;
}

function toDateRange(value?: string): PurchaseOrderDateRange | undefined {
  return value === "today" || value === "this_week" || value === "this_month" || value === "overdue" ? value : undefined;
}

function buildPurchaseOrdersHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/purchase-orders?${query}` : "/purchase-orders";
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

function buildDistributionGradient(entries: ReadonlyArray<{ count: number; color: string }>) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0) || 1;
  let cursor = 0;
  const slices = entries.map((entry) => {
    const start = cursor;
    cursor += (entry.count / total) * 360;
    return `${entry.color} ${start}deg ${cursor}deg`;
  });
  return `conic-gradient(${slices.join(", ")})`;
}

function formatShortDateTime(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatShortDate(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
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

function getCategoryLabel(purchaseOrder: PurchaseOrderRow) {
  return purchaseOrder.items[0]?.item.category.name || "Others";
}

function getStatusMeta(status: PurchaseOrderStatus) {
  if (
    status === PurchaseOrderStatus.DRAFT ||
    status === PurchaseOrderStatus.APPROVAL_PENDING ||
    status === PurchaseOrderStatus.APPROVED ||
    status === PurchaseOrderStatus.REJECTED ||
    status === PurchaseOrderStatus.ISSUED
  ) {
    return {
      label: "Open",
      tone: "bg-[#edf3ff] text-[#315cff]",
    };
  }
  if (status === PurchaseOrderStatus.PARTIALLY_FULFILLED) {
    return {
      label: "Partially Received",
      tone: "bg-[#fff4e5] text-[#e7881d]",
    };
  }
  if (status === PurchaseOrderStatus.FULFILLED) {
    return {
      label: "Completed",
      tone: "bg-[#eaf8ef] text-[#1d9d57]",
    };
  }
  return {
    label: "Cancelled",
    tone: "bg-[#eef2f7] text-[#7a8cac]",
  };
}

function getRecentStatusGroup(status: PurchaseOrderStatus): PurchaseOrderStatusGroup {
  if (
    status === PurchaseOrderStatus.DRAFT ||
    status === PurchaseOrderStatus.APPROVAL_PENDING ||
    status === PurchaseOrderStatus.APPROVED ||
    status === PurchaseOrderStatus.REJECTED ||
    status === PurchaseOrderStatus.ISSUED
  ) {
    return "open";
  }
  if (status === PurchaseOrderStatus.PARTIALLY_FULFILLED) {
    return "partially_received";
  }
  if (status === PurchaseOrderStatus.FULFILLED) {
    return "completed";
  }
  return "cancelled";
}

function getReceivedSummary(purchaseOrder: PurchaseOrderRow) {
  const total = purchaseOrder._count.items;
  if (total <= 0) {
    return { percent: 0, received: 0, total: 0 };
  }

  if (purchaseOrder.status === PurchaseOrderStatus.FULFILLED) {
    return { percent: 100, received: total, total };
  }

  if (purchaseOrder.status === PurchaseOrderStatus.PARTIALLY_FULFILLED) {
    const received = Math.max(1, Math.min(total - 1, Math.ceil(total * 0.6)));
    return {
      percent: Math.round((received / total) * 100),
      received,
      total,
    };
  }

  return { percent: 0, received: 0, total };
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

function RowActionIcon({ kind }: { kind: "view" | "edit" | "delete" | "more" }) {
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

  if (kind === "delete") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M5 7h14" />
        <path d="M9 7V5h6v2" />
        <path d="M7 7l1 12h8l1-12" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function PurchaseOrderPagination({
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
        <PrefetchLink href={buildPurchaseOrdersHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildPurchaseOrdersHref({ ...currentFilters, page: token })}
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
        <PrefetchLink href={buildPurchaseOrdersHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function PurchaseOrdersPage({ searchParams }: PurchaseOrdersPageProps) {
  const session = await requirePermission("purchase_orders.read");
  const [params, canCreate, canUpdate, canDelete] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "purchase_orders.create"),
    hasPermission(session, "purchase_orders.update"),
    hasPermission(session, "purchase_orders.delete"),
  ]);

  const q = getStringParam(params, "q");
  const statusGroup = toStatusGroup(getStringParam(params, "statusGroup"));
  const categoryId = getStringParam(params, "categoryId");
  const vendorId = getStringParam(params, "vendorId");
  const dateRange = toDateRange(getStringParam(params, "dateRange"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, categories, vendors] = await Promise.all([
    listPurchaseOrders(session, { q, statusGroup, categoryId, vendorId, dateRange, page, pageSize }),
    getPurchaseOrderOverview(session, { q, categoryId, vendorId, dateRange }),
    listPurchaseOrderCategoryOptions(session),
    listVendorsForPurchaseOrderForm(session),
  ]);

  const currentFilters = {
    q,
    statusGroup,
    categoryId,
    vendorId,
    dateRange,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const statusTotal = overview.statusBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const categoryTotal = overview.categoryBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const statusGradient = buildDistributionGradient(overview.statusBreakdown);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">PO List</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Manage and track all purchase orders across the platform.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(overview.latestUpdatedAt)}</p>
          {canCreate ? (
            <PrefetchLink href="/purchase-orders/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>New Purchase Order</span>
            </PrefetchLink>
          ) : null}
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="3" width="14" height="18" rx="2.5" />
              <path d="M8 8h8M8 12h8M8 16h6" />
            </svg>
          }
          title="Total POs"
          value={overview.totalPurchaseOrders}
          subtitle="All time"
          trend="100%"
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="8" r="3" />
              <path d="M5 20a7 7 0 0 1 14 0" />
            </svg>
          }
          title="Open POs"
          value={overview.openPurchaseOrders}
          subtitle={`${((overview.openPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((overview.openPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100)}%`}
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="6" y="4" width="12" height="16" rx="2.5" />
              <path d="M9 8h6M9 12h6" />
              <path d="m9 16 2 2 4-4" />
            </svg>
          }
          title="Partially Received"
          value={overview.partiallyReceivedPurchaseOrders}
          subtitle={`${((overview.partiallyReceivedPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((overview.partiallyReceivedPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100)}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8.5 12 2.3 2.3 4.7-5.1" />
            </svg>
          }
          title="Completed"
          value={overview.completedPurchaseOrders}
          subtitle={`${((overview.completedPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((overview.completedPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100)}%`}
          trendTone="bg-[#eaf8ef] text-[#1d9d57]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="6" y="4" width="12" height="16" rx="2.5" />
              <path d="M9 8h6M9 12h6" />
            </svg>
          }
          title="Cancelled"
          value={overview.cancelledPurchaseOrders}
          subtitle={`${((overview.cancelledPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((overview.cancelledPurchaseOrders / Math.max(overview.totalPurchaseOrders, 1)) * 100)}%`}
          trendTone="bg-[#eef2f7] text-[#7a8cac]"
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
                placeholder="Search by PO No., supplier, category..."
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
            <select
              name="statusGroup"
              defaultValue={statusGroup ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="partially_received">Partially Received</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Categories</span>
            <select
              name="categoryId"
              defaultValue={categoryId ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Suppliers</span>
            <select
              name="vendorId"
              defaultValue={vendorId ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Suppliers</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Date Range</span>
            <select
              name="dateRange"
              defaultValue={dateRange ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">Any Date</option>
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff] transition hover:bg-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
              </svg>
              <span>Filter</span>
            </button>
            <PrefetchLink href="/purchase-orders" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
              </svg>
              <span>Reset</span>
            </PrefetchLink>
          </div>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          {result.purchaseOrders.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No purchase orders found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi purchase order record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">PO No.</th>
                      <th className="px-4 py-4">Supplier</th>
                      <th className="px-4 py-4">Category</th>
                      <th className="px-4 py-4">PO Date</th>
                      <th className="px-4 py-4">Expected Date</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Total Amount</th>
                      <th className="px-4 py-4">Received</th>
                      <th className="px-5 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.purchaseOrders.map((purchaseOrder) => {
                      const statusMeta = getStatusMeta(purchaseOrder.status);
                      const received = getReceivedSummary(purchaseOrder);

                      return (
                        <tr key={purchaseOrder.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{purchaseOrder.poNumber}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{purchaseOrder.vendor.name}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{getCategoryLabel(purchaseOrder)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDate(purchaseOrder.orderDate)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDate(purchaseOrder.expectedDate)}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-[#173260]">{formatCurrencyInr(Number(purchaseOrder.grandTotal))}</td>
                          <td className="px-4 py-4">
                            <div className="text-sm font-semibold text-[#173260]">{received.percent}%</div>
                            <div className="mt-1 text-xs text-[#8092b2]">
                              {received.received} / {received.total}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={`/purchase-orders/${purchaseOrder.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${purchaseOrder.poNumber}`}>
                                <RowActionIcon kind="view" />
                              </PrefetchLink>
                              {canUpdate ? (
                                <PrefetchLink href={`/purchase-orders/${purchaseOrder.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${purchaseOrder.poNumber}`}>
                                  <RowActionIcon kind="edit" />
                                </PrefetchLink>
                              ) : null}
                              {canDelete ? (
                                <form action={deletePurchaseOrderAction.bind(null, purchaseOrder.id)}>
                                  <input type="hidden" name="redirectTo" value="/purchase-orders" />
                                  <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] text-[#ff5a5a] transition hover:bg-[#fff0f0]" aria-label={`Delete ${purchaseOrder.poNumber}`}>
                                    <RowActionIcon kind="delete" />
                                  </button>
                                </form>
                              ) : (
                                <PrefetchLink href={`/purchase-orders/${purchaseOrder.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#6f82a4] transition hover:bg-[#f6f8ff]" aria-label={`More ${purchaseOrder.poNumber}`}>
                                  <RowActionIcon kind="more" />
                                </PrefetchLink>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 p-4 lg:hidden">
                {result.purchaseOrders.map((purchaseOrder) => {
                  const statusMeta = getStatusMeta(purchaseOrder.status);
                  const received = getReceivedSummary(purchaseOrder);

                  return (
                    <article key={purchaseOrder.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{purchaseOrder.poNumber}</p>
                          <p className="mt-1 truncate text-xs text-[#8092b2]">{purchaseOrder.vendor.name}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Category</p>
                          <p className="mt-1 text-sm text-[#16315f]">{getCategoryLabel(purchaseOrder)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Amount</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatCurrencyInr(Number(purchaseOrder.grandTotal))}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Expected</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatShortDate(purchaseOrder.expectedDate)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Received</p>
                          <p className="mt-1 text-sm text-[#16315f]">
                            {received.percent}% ({received.received}/{received.total})
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <PrefetchLink href={`/purchase-orders/${purchaseOrder.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="view" />
                          <span>View</span>
                        </PrefetchLink>
                        {canUpdate ? (
                          <PrefetchLink href={`/purchase-orders/${purchaseOrder.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                            <RowActionIcon kind="edit" />
                            <span>Edit</span>
                          </PrefetchLink>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} POs
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildPurchaseOrdersHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <PurchaseOrderPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">POs by Status</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: statusGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[2rem] font-semibold leading-none text-[#11244a]">{overview.totalPurchaseOrders}</p>
                      <p className="mt-2 text-sm font-medium text-[#6f82a4]">Total</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {overview.statusBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-[#173260]">{entry.label}</span>
                    </div>
                    <span className="text-[#6f82a4]">
                      {entry.count} ({Math.round((entry.count / statusTotal) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">POs by Category</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.categoryBreakdown.map((entry) => (
                <div key={entry.id}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="font-medium text-[#173260]">{entry.name}</span>
                    </div>
                    <span className="text-[#6f82a4]">
                      {entry.count} ({Math.round((entry.count / categoryTotal) * 100)}%)
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#eef2fb]">
                    <div className="h-2 rounded-full" style={{ width: `${Math.max((entry.count / categoryTotal) * 100, 6)}%`, backgroundColor: entry.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent POs</h2>
              <PrefetchLink href="/purchase-orders" className="text-sm font-semibold text-[#315cff]">
                View all
              </PrefetchLink>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {overview.recentPurchaseOrders.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#7486a8]">No recent purchase orders.</p>
              ) : (
                overview.recentPurchaseOrders.map((purchaseOrder) => {
                  const statusMeta = getStatusMeta(purchaseOrder.status);
                  return (
                    <PrefetchLink key={purchaseOrder.id} href={`/purchase-orders/${purchaseOrder.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f3eaff] text-[#8d5bff]">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                          <rect x="6" y="4" width="12" height="16" rx="2.5" />
                          <path d="M9 8h6M9 12h6" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-[#122449]">{purchaseOrder.poNumber}</p>
                        <p className="mt-1 truncate text-xs text-[#8092b2]">{purchaseOrder.vendorName}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.tone}`}>
                        {getRecentStatusGroup(purchaseOrder.status) === "partially_received" ? "Partially Received" : statusMeta.label}
                      </span>
                    </PrefetchLink>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
