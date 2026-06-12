import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { deleteVendorPaymentAction } from "@/features/vendor-payments/actions/vendor-payment.actions";
import {
  getVendorPaymentLinkedInvoiceNumber,
  getVendorPaymentMethod,
  getVendorPaymentMethodLabel,
  getVendorPaymentOverview,
  getVendorPaymentReferenceNumber,
  getVendorPaymentStatusGroup,
  listVendorPayments,
  listVendorsForVendorPaymentForm,
  type VendorPaymentDateRange,
  type VendorPaymentMethod,
  type VendorPaymentStatusGroup,
} from "@/features/vendor-payments/services/vendor-payment.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr } from "@/lib/utils/format";

type VendorPaymentsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type VendorPaymentsResult = Awaited<ReturnType<typeof listVendorPayments>>;
type VendorPaymentRow = VendorPaymentsResult["vendorPayments"][number];

const pageSizeOptions = [10, 20, 25];
const methodOptions: Array<{ value: VendorPaymentMethod; label: string }> = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "neft", label: "NEFT" },
  { value: "rtgs", label: "RTGS" },
  { value: "cheque", label: "Cheque" },
  { value: "others", label: "Others" },
];

function getSuccessMessage(code?: string) {
  if (code === "vendor-payment-recorded") {
    return "Vendor payment recorded successfully.";
  }
  if (code === "vendor-payment-updated") {
    return "Vendor payment updated successfully.";
  }
  if (code === "vendor-payment-status-updated") {
    return "Vendor payment status updated successfully.";
  }
  if (code === "vendor-payment-deleted") {
    return "Vendor payment voided successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "vendor-payment-validation") {
    return "Vendor payment validation failed.";
  }
  if (code === "vendor-payment-status-validation") {
    return "Vendor payment status validation failed.";
  }
  if (code === "vendor-payment-duplicate") {
    return "Duplicate vendor payment number detected.";
  }
  if (code === "vendor-payment-mismatch") {
    return "Vendor payment action blocked by tenant scope mismatch.";
  }
  return undefined;
}

function toStatusGroup(value?: string): VendorPaymentStatusGroup | undefined {
  return value === "completed" || value === "pending" || value === "overdue" ? value : undefined;
}

function toMethod(value?: string): VendorPaymentMethod | undefined {
  return value === "bank_transfer" || value === "neft" || value === "rtgs" || value === "cheque" || value === "others" ? value : undefined;
}

function toDateRange(value?: string): VendorPaymentDateRange | undefined {
  return value === "today" || value === "this_week" || value === "this_month" || value === "overdue" ? value : undefined;
}

function buildVendorPaymentsHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/vendor-payments?${query}` : "/vendor-payments";
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

function getStatusMeta(status: VendorPaymentStatusGroup) {
  if (status === "completed") {
    return { label: "Completed", tone: "bg-[#eaf8ef] text-[#1d9d57]" };
  }
  if (status === "overdue") {
    return { label: "Overdue", tone: "bg-[#fff1f1] text-[#ff4f5e]" };
  }
  return { label: "Pending", tone: "bg-[#fff4e5] text-[#e7881d]" };
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
  value: string;
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

function VendorPaymentsPagination({
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
        <PrefetchLink href={buildVendorPaymentsHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildVendorPaymentsHref({ ...currentFilters, page: token })}
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
        <PrefetchLink href={buildVendorPaymentsHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function VendorPaymentsPage({ searchParams }: VendorPaymentsPageProps) {
  const session = await requirePermission("vendor_payments.read");
  const [params, canCreate, canUpdate, canDelete] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "vendor_payments.create"),
    hasPermission(session, "vendor_payments.update"),
    hasPermission(session, "vendor_payments.delete"),
  ]);

  const q = getStringParam(params, "q");
  const statusGroup = toStatusGroup(getStringParam(params, "statusGroup"));
  const vendorId = getStringParam(params, "vendorId");
  const method = toMethod(getStringParam(params, "method"));
  const dateRange = toDateRange(getStringParam(params, "dateRange"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, vendors] = await Promise.all([
    listVendorPayments(session, { q, statusGroup, vendorId, method, dateRange, page, pageSize }),
    getVendorPaymentOverview(session, { q, vendorId, method, dateRange }),
    listVendorsForVendorPaymentForm(session),
  ]);

  const currentFilters = {
    q,
    statusGroup,
    vendorId,
    method,
    dateRange,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const statusTotal = overview.statusBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const statusGradient = buildDistributionGradient(overview.statusBreakdown);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Vendor Payments</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Track and manage all vendor payments across the platform.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(overview.latestUpdatedAt)}</p>
          {canCreate ? (
            <PrefetchLink href="/vendor-payments/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>New Payment</span>
            </PrefetchLink>
          ) : null}
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="3" width="14" height="18" rx="2.5" />
              <path d="M8 8h8M8 12h8M8 16h6" />
            </svg>
          }
          title="Total Payments"
          value={overview.totalPayments.toLocaleString("en-IN")}
          subtitle="All time"
          trend="100%"
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="4" width="14" height="16" rx="2.5" />
              <path d="M8 8h8M8 12h5M15.5 15.5h.01" />
            </svg>
          }
          title="Paid This Month"
          value={formatCurrencyInr(overview.paidThisMonthAmount)}
          subtitle="Current month disbursements"
          trend={`${Math.round((overview.paidThisMonthAmount / Math.max(overview.totalPaidAmount, 1)) * 100)}%`}
          trendTone="bg-[#eaf8ef] text-[#1d9d57]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </svg>
          }
          title="Pending Payments"
          value={formatCurrencyInr(overview.pendingAmount)}
          subtitle="Awaiting release"
          trend={`${Math.round((overview.pendingAmount / Math.max(overview.totalPaidAmount + overview.pendingAmount + overview.overdueAmount, 1)) * 100)}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          }
          title="Overdue Payments"
          value={formatCurrencyInr(overview.overdueAmount)}
          subtitle="Needs attention"
          trend={`${Math.round((overview.overdueAmount / Math.max(overview.totalPaidAmount + overview.pendingAmount + overview.overdueAmount, 1)) * 100)}%`}
          trendTone="bg-[#fff1f1] text-[#ff4f5e]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 7v5l3 3" />
            </svg>
          }
          title="Avg. Payment Time"
          value={`${overview.averagePaymentDays.toFixed(1)} Days`}
          subtitle="Average settlement cycle"
          trend={overview.averagePaymentDays <= 7 ? "Fast" : "In review"}
          trendTone={overview.averagePaymentDays <= 7 ? "bg-[#eaf8ef] text-[#1d9d57]" : "bg-[#fff4e5] text-[#e7881d]"}
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M8 12h8M12 8v8" />
            </svg>
          }
          title="Total Paid (All Time)"
          value={formatCurrencyInr(overview.totalPaidAmount)}
          subtitle="Completed payments"
          trend={formatCurrencyInr(overview.totalPaidAmount)}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-4 py-4 sm:px-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr_1fr_auto] xl:items-end">
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
                    placeholder="Search by payment no., vendor, ref no., invoice no..."
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
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                  <option value="overdue">Overdue</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Vendors</span>
                <select
                  name="vendorId"
                  defaultValue={vendorId ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Vendors</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Methods</span>
                <select
                  name="method"
                  defaultValue={method ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Methods</option>
                  {methodOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
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
                <PrefetchLink href="/vendor-payments" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
              </div>
            </form>
          </div>

          {result.vendorPayments.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No vendor payments found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi vendor payment record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Payment No.</th>
                      <th className="px-4 py-4">Vendor</th>
                      <th className="px-4 py-4">Invoice No.</th>
                      <th className="px-4 py-4">Payment Date</th>
                      <th className="px-4 py-4">Payment Method</th>
                      <th className="px-4 py-4">Reference No.</th>
                      <th className="px-4 py-4">Amount</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.vendorPayments.map((payment) => {
                      const statusMeta = getStatusMeta(getVendorPaymentStatusGroup(payment));
                      const methodLabel = getVendorPaymentMethodLabel(getVendorPaymentMethod(payment));
                      return (
                        <tr key={payment.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{payment.paymentNumber}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{payment.vendor.name}</td>
                          <td className="px-4 py-4 text-sm text-[#315cff]">{getVendorPaymentLinkedInvoiceNumber(payment)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDate(payment.paidAt ?? payment.createdAt)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{methodLabel}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{getVendorPaymentReferenceNumber(payment)}</td>
                          <td className="px-4 py-4 text-sm font-semibold text-[#173260]">{formatCurrencyInr(Number(payment.amount))}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={`/vendor-payments/${payment.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${payment.paymentNumber}`}>
                                <RowActionIcon kind="view" />
                              </PrefetchLink>
                              {canUpdate ? (
                                <PrefetchLink href={`/vendor-payments/${payment.id}/edit`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${payment.paymentNumber}`}>
                                  <RowActionIcon kind="edit" />
                                </PrefetchLink>
                              ) : null}
                              {canDelete ? (
                                <form action={deleteVendorPaymentAction.bind(null, payment.id)}>
                                  <input type="hidden" name="redirectTo" value="/vendor-payments" />
                                  <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] text-[#ff5a5a] transition hover:bg-[#fff0f0]" aria-label={`Delete ${payment.paymentNumber}`}>
                                    <RowActionIcon kind="delete" />
                                  </button>
                                </form>
                              ) : (
                                <PrefetchLink href={`/vendor-payments/${payment.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#6f82a4] transition hover:bg-[#f6f8ff]" aria-label={`More ${payment.paymentNumber}`}>
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
                {result.vendorPayments.map((payment) => {
                  const statusMeta = getStatusMeta(getVendorPaymentStatusGroup(payment));
                  const methodLabel = getVendorPaymentMethodLabel(getVendorPaymentMethod(payment));
                  return (
                    <article key={payment.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{payment.paymentNumber}</p>
                          <p className="mt-1 truncate text-xs text-[#8092b2]">{payment.vendor.name}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Invoice No.</p>
                          <p className="mt-1 text-sm text-[#16315f]">{getVendorPaymentLinkedInvoiceNumber(payment)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Method</p>
                          <p className="mt-1 text-sm text-[#16315f]">{methodLabel}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Payment Date</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatShortDate(payment.paidAt ?? payment.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Amount</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatCurrencyInr(Number(payment.amount))}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <PrefetchLink href={`/vendor-payments/${payment.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="view" />
                          <span>View</span>
                        </PrefetchLink>
                        {canUpdate ? (
                          <PrefetchLink href={`/vendor-payments/${payment.id}/edit`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
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
                  Showing {showingFrom} to {showingTo} of {result.total} payments
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildVendorPaymentsHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <VendorPaymentsPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Payments by Status</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: statusGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[2rem] font-semibold leading-none text-[#11244a]">{overview.totalPayments}</p>
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
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Payments by Method</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.methodBreakdown.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-[#173260]">{entry.label}</span>
                  </div>
                  <span className="text-[#6f82a4]">{entry.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent Payments</h2>
              <PrefetchLink href="/vendor-payments" className="text-sm font-semibold text-[#315cff]">
                View all
              </PrefetchLink>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {overview.recentPayments.map((payment) => {
                const statusMeta = getStatusMeta(payment.statusGroup);
                return (
                  <PrefetchLink key={payment.id} href={`/vendor-payments/${payment.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-[#edf3ff] text-[#315cff]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <rect x="5" y="3" width="14" height="18" rx="2.5" />
                        <path d="M8 8h8M8 12h8M8 16h6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{payment.paymentNumber}</p>
                      <p className="mt-1 truncate text-xs text-[#8092b2]">{payment.vendorName}</p>
                      <p className="mt-1 text-xs text-[#92a2bf]">{formatShortDate(payment.paymentDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-[#173260]">{formatCurrencyInr(payment.amount)}</p>
                      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                    </div>
                  </PrefetchLink>
                );
              })}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">This Month Summary</h2>
            </div>
            <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
              <div className="rounded-2xl bg-[#f5fbf7] px-4 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1d9d57]">Paid</p>
                <p className="mt-3 text-lg font-semibold text-[#173260]">{formatCurrencyInr(overview.monthlySummary.paid)}</p>
              </div>
              <div className="rounded-2xl bg-[#fff8ee] px-4 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#e7881d]">Pending</p>
                <p className="mt-3 text-lg font-semibold text-[#173260]">{formatCurrencyInr(overview.monthlySummary.pending)}</p>
              </div>
              <div className="rounded-2xl bg-[#fff3f3] px-4 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ff4f5e]">Overdue</p>
                <p className="mt-3 text-lg font-semibold text-[#173260]">{formatCurrencyInr(overview.monthlySummary.overdue)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
