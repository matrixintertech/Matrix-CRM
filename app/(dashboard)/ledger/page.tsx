import type { ReactNode } from "react";

import {
  getLedgerOverview,
  listLedgerEntries,
  type LedgerAccountGroup,
  type LedgerDateRange,
  type LedgerEntryDirection,
  type LedgerStatusFilter,
} from "@/features/ledger/services/ledger.service";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr } from "@/lib/utils/format";

type LedgerPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type LedgerResult = Awaited<ReturnType<typeof listLedgerEntries>>;
type LedgerEntryRow = LedgerResult["entries"][number];

const pageSizeOptions = [10, 20, 25];

function toAccountGroup(value?: string): LedgerAccountGroup | undefined {
  return value === "receivables" || value === "payables" || value === "expenses" || value === "inventory" ? value : undefined;
}

function toEntryType(value?: string): LedgerEntryDirection | undefined {
  return value === "debit" || value === "credit" ? value : undefined;
}

function toStatusFilter(value?: string): LedgerStatusFilter | undefined {
  return value === "completed" || value === "pending" ? value : undefined;
}

function toDateRange(value?: string): LedgerDateRange | undefined {
  return value === "today" || value === "this_week" || value === "this_month" || value === "overdue" ? value : undefined;
}

function buildLedgerHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/ledger?${query}` : "/ledger";
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

function buildDistributionGradient(entries: ReadonlyArray<{ amount: number; color: string }>) {
  const total = entries.reduce((sum, entry) => sum + Math.max(entry.amount, 0), 0) || 1;
  let cursor = 0;
  const slices = entries.map((entry) => {
    const start = cursor;
    cursor += (Math.max(entry.amount, 0) / total) * 360;
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

function getTypeMeta(entry: LedgerEntryRow) {
  if (Number(entry.creditAmount) > 0) {
    return {
      label: "Credit",
      tone: "bg-[#eaf8ef] text-[#1d9d57]",
    };
  }

  return {
    label: "Debit",
    tone: "bg-[#fff1f1] text-[#ff4f5e]",
  };
}

function getStatusMeta(entry: LedgerEntryRow) {
  const status =
    entry.payment?.status ??
    entry.vendorPayment?.status ??
    entry.expense?.status ??
    "COMPLETED";

  if (status === "PAID" || status === "APPROVED" || status === "PARTIALLY_PAID" || status === "COMPLETED") {
    return {
      label: "Completed",
      tone: "bg-[#eaf8ef] text-[#1d9d57]",
    };
  }

  return {
    label: "Pending",
    tone: "bg-[#fff4e5] text-[#e7881d]",
  };
}

function getAccountLabel(entry: LedgerEntryRow) {
  if (entry.payment?.client?.name) {
    return entry.payment.client.name;
  }
  if (entry.vendorPayment?.vendor?.name) {
    return entry.vendorPayment.vendor.name;
  }
  if (entry.expense?.vendor?.name) {
    return entry.expense.vendor.name;
  }
  if (entry.inventoryTransaction?.vendor?.name) {
    return entry.inventoryTransaction.vendor.name;
  }

  if (entry.sourceType === "PAYMENT") {
    return "Accounts Receivable";
  }
  if (entry.sourceType === "VENDOR_PAYMENT") {
    return "Accounts Payable";
  }
  if (entry.sourceType === "EXPENSE") {
    return "Expenses";
  }
  return "Inventory";
}

function getReferenceLabel(entry: LedgerEntryRow) {
  return (
    entry.payment?.paymentNumber ||
    entry.vendorPayment?.paymentNumber ||
    entry.expense?.expenseNumber ||
    entry.inventoryTransaction?.referenceNo ||
    `LED-${entry.id.slice(0, 8).toUpperCase()}`
  );
}

function getViewHref(entry: LedgerEntryRow) {
  if (entry.vendorPayment?.id) {
    return `/vendor-payments/${entry.vendorPayment.id}`;
  }
  if (entry.payment?.invoice?.id) {
    return `/invoices/${entry.payment.invoice.id}`;
  }
  if (entry.serviceRequest?.id) {
    return `/service-requests/${entry.serviceRequest.id}`;
  }
  return "/ledger";
}

function getEditHref(entry: LedgerEntryRow) {
  if (entry.vendorPayment?.id) {
    return `/vendor-payments/${entry.vendorPayment.id}/edit`;
  }
  if (entry.payment?.invoice?.id) {
    return `/invoices/${entry.payment.invoice.id}/edit`;
  }
  return getViewHref(entry);
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
}: {
  icon: ReactNode;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#e8edf7] bg-white/95 p-5 shadow-[0_16px_40px_rgba(23,52,110,0.06)]">
      <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/70 bg-gradient-to-br from-[#f8f9ff] to-[#eef3ff] text-[#315cff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
        {icon}
      </div>
      <p className="mt-4 text-sm font-medium text-[#63759b]">{title}</p>
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function RowActionIcon({ kind }: { kind: "view" | "edit" }) {
  if (kind === "view") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
    </svg>
  );
}

function LedgerPagination({
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
        <PrefetchLink href={buildLedgerHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildLedgerHref({ ...currentFilters, page: token })}
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
        <PrefetchLink href={buildLedgerHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const session = await requirePermission("ledger.read");
  const [params, canCreateInvoice, canCreateVendorPayment] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "invoices.create"),
    hasPermission(session, "vendor_payments.create"),
  ]);

  const q = getStringParam(params, "q");
  const accountGroup = toAccountGroup(getStringParam(params, "accountGroup"));
  const entryType = toEntryType(getStringParam(params, "entryType"));
  const status = toStatusFilter(getStringParam(params, "status"));
  const dateRange = toDateRange(getStringParam(params, "dateRange"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;

  const [result, overview] = await Promise.all([
    listLedgerEntries(session, { q, accountGroup, entryType, status, dateRange, page, pageSize }),
    getLedgerOverview(session, { q, accountGroup, entryType, status, dateRange }),
  ]);

  const currentFilters = {
    q,
    accountGroup,
    entryType,
    status,
    dateRange,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const accountGradient = buildDistributionGradient(overview.accountSummary);
  const accountsTotal = overview.accountSummary.reduce((sum, entry) => sum + Math.max(entry.amount, 0), 0) || 1;
  const createHref = canCreateVendorPayment ? "/vendor-payments/new" : canCreateInvoice ? "/invoices/new" : undefined;
  const createLabel = canCreateVendorPayment ? "New Vendor Payment" : "Record Vendor Invoice";

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Ledger</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Track posted payables, invoice settlements, and vendor payment ledger movement. Manual chart-of-accounts entry is not exposed in this app.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(result.entries[0]?.entryDate ?? null)}</p>
          {createHref ? (
            <PrefetchLink href={createHref} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>{createLabel}</span>
            </PrefetchLink>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="5" width="14" height="14" rx="3" />
              <path d="M8 10h8M8 14h5" />
            </svg>
          }
          title="Total Balance"
          value={formatCurrencyInr(overview.totalBalance)}
          subtitle="All accounts"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 4v16" />
              <path d="m6 14 6 6 6-6" />
            </svg>
          }
          title="Total Debit"
          value={formatCurrencyInr(overview.totalDebit)}
          subtitle="This period"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 20V4" />
              <path d="m6 10 6-6 6 6" />
            </svg>
          }
          title="Total Credit"
          value={formatCurrencyInr(overview.totalCredit)}
          subtitle="This period"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M4 17h16" />
              <path d="M6 17 9 7l3 10 3-6 3 6" />
            </svg>
          }
          title="Net Balance"
          value={formatCurrencyInr(overview.netBalance)}
          subtitle="As on date"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="6" y="4" width="12" height="16" rx="2.5" />
              <path d="M9 8h6M9 12h6" />
            </svg>
          }
          title="No. of Transactions"
          value={overview.transactionCount.toLocaleString("en-IN")}
          subtitle="This period"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-4 py-4 sm:px-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_1fr_1fr_1fr_1fr_auto] xl:items-end">
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
                    placeholder="Search by date, account, ref no., description..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Accounts</span>
                <select
                  name="accountGroup"
                  defaultValue={accountGroup ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Accounts</option>
                  <option value="receivables">Accounts Receivable</option>
                  <option value="payables">Accounts Payable</option>
                  <option value="expenses">Expenses</option>
                  <option value="inventory">Inventory</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Types</span>
                <select
                  name="entryType"
                  defaultValue={entryType ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Types</option>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
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
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
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
                <PrefetchLink href="/ledger" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
              </div>
            </form>
          </div>

          {result.entries.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No ledger entries found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi ledger transaction record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Date</th>
                      <th className="px-4 py-4">Ref. No.</th>
                      <th className="px-4 py-4">Account</th>
                      <th className="px-4 py-4">Description</th>
                      <th className="px-4 py-4">Type</th>
                      <th className="px-4 py-4">Debit</th>
                      <th className="px-4 py-4">Credit</th>
                      <th className="px-4 py-4">Balance</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.entries.map((entry) => {
                      const typeMeta = getTypeMeta(entry);
                      const statusMeta = getStatusMeta(entry);
                      return (
                        <tr key={entry.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-5 py-4 text-sm text-[#24406f]">{formatShortDateTime(entry.entryDate)}</td>
                          <td className="px-4 py-4 text-sm font-semibold text-[#315cff]">{getReferenceLabel(entry)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{getAccountLabel(entry)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{entry.description?.trim() || "-"}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${typeMeta.tone}`}>{typeMeta.label}</span>
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-[#ff4f5e]">
                            {Number(entry.debitAmount) > 0 ? formatCurrencyInr(Number(entry.debitAmount)) : "-"}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-[#1d9d57]">
                            {Number(entry.creditAmount) > 0 ? formatCurrencyInr(Number(entry.creditAmount)) : "-"}
                          </td>
                          <td className="px-4 py-4 text-sm font-semibold text-[#173260]">{formatCurrencyInr(entry.runningBalance)}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={getViewHref(entry)} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${getReferenceLabel(entry)}`}>
                                <RowActionIcon kind="view" />
                              </PrefetchLink>
                              <PrefetchLink href={getEditHref(entry)} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${getReferenceLabel(entry)}`}>
                                <RowActionIcon kind="edit" />
                              </PrefetchLink>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 p-4 lg:hidden">
                {result.entries.map((entry) => {
                  const typeMeta = getTypeMeta(entry);
                  const statusMeta = getStatusMeta(entry);

                  return (
                    <article key={entry.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{getReferenceLabel(entry)}</p>
                          <p className="mt-1 truncate text-xs text-[#8092b2]">{getAccountLabel(entry)}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Type</p>
                          <p className="mt-1 text-sm text-[#16315f]">{typeMeta.label}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Balance</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatCurrencyInr(entry.runningBalance)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Debit</p>
                          <p className="mt-1 text-sm text-[#16315f]">{Number(entry.debitAmount) > 0 ? formatCurrencyInr(Number(entry.debitAmount)) : "-"}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Credit</p>
                          <p className="mt-1 text-sm text-[#16315f]">{Number(entry.creditAmount) > 0 ? formatCurrencyInr(Number(entry.creditAmount)) : "-"}</p>
                        </div>
                      </div>

                      <p className="mt-4 text-sm text-[#24406f]">{entry.description?.trim() || "-"}</p>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <PrefetchLink href={getViewHref(entry)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="view" />
                          <span>View</span>
                        </PrefetchLink>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} transactions
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildLedgerHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <LedgerPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Account Summary</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: accountGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[1.6rem] font-semibold leading-none text-[#11244a]">{formatCurrencyInr(overview.totalBalance)}</p>
                      <p className="mt-2 text-sm font-medium text-[#6f82a4]">Total Balance</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {overview.accountSummary.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-[#173260]">{entry.label}</span>
                    </div>
                    <span className="text-[#6f82a4]">{formatCurrencyInr(entry.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top Accounts by Balance</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.topAccounts.map((entry) => (
                <div key={entry.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#173260]">{entry.label}</span>
                    <span className="text-[#6f82a4]">{formatCurrencyInr(entry.amount)}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#eef2fb]">
                    <div className="h-2 rounded-full" style={{ width: `${Math.max((entry.amount / accountsTotal) * 100, 6)}%`, backgroundColor: entry.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent Transactions</h2>
              <PrefetchLink href="/ledger" className="text-sm font-semibold text-[#315cff]">
                View all
              </PrefetchLink>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {overview.recentTransactions.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#7486a8]">No recent transactions.</p>
              ) : (
                overview.recentTransactions.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 px-5 py-4">
                    <div className={`grid h-10 w-10 place-items-center rounded-full ${entry.amount >= 0 ? "bg-[#eaf8ef] text-[#1d9d57]" : "bg-[#fff1f1] text-[#ff4f5e]"}`}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <path d={entry.amount >= 0 ? "M12 18V6m0 0-4 4m4-4 4 4" : "M12 6v12m0 0-4-4m4 4 4-4"} />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{entry.description}</p>
                      <p className="mt-1 text-xs text-[#8092b2]">{formatShortDate(entry.entryDate)}</p>
                    </div>
                    <span className={`text-sm font-semibold ${entry.amount >= 0 ? "text-[#1d9d57]" : "text-[#ff4f5e]"}`}>
                      {entry.amount >= 0 ? "+" : "-"}
                      {formatCurrencyInr(Math.abs(entry.amount))}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {(canCreateInvoice || canCreateVendorPayment) ? (
            <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
              <div className="border-b border-[#edf2fb] px-5 py-4">
                <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Quick Actions</h2>
              </div>
              <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
                {canCreateInvoice ? (
                  <PrefetchLink href="/invoices/new" className="flex items-center justify-center gap-2 rounded-[18px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:border-[#d9e3ff] hover:bg-white">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-[#eaf8ef] text-[#1d9d57]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <path d="M12 18V6m0 0-4 4m4-4 4 4" />
                      </svg>
                    </span>
                    <span>Record Vendor Invoice</span>
                  </PrefetchLink>
                ) : null}
                {canCreateVendorPayment ? (
                  <PrefetchLink href="/vendor-payments/new" className="flex items-center justify-center gap-2 rounded-[18px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:border-[#d9e3ff] hover:bg-white">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-[#fff1f1] text-[#ff4f5e]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <path d="M12 6v12m0 0-4-4m4 4 4-4" />
                      </svg>
                    </span>
                    <span>New Vendor Payment</span>
                  </PrefetchLink>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
