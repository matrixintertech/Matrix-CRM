import type { ReactNode } from "react";

import { InvoiceStatus, LedgerSourceType, PaymentStatus } from "@prisma/client";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { getFinanceReportData } from "@/features/finance-reports/services/finance-report.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr } from "@/lib/utils/format";

type FinanceReportsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type FinanceReportData = Awaited<ReturnType<typeof getFinanceReportData>>;
type PayableRow = FinanceReportData["payables"][number];
type PaymentRow = FinanceReportData["paymentsMade"][number];

function buildFinanceReportsHref(filters: Record<string, string | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (!value) {
      continue;
    }
    params.set(key, value);
  }

  const query = params.toString();
  return query ? `/finance-reports?${query}` : "/finance-reports";
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

function formatInputDate(value?: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function formatRelativeRefresh(value: Date | null) {
  if (!value) {
    return "No recent activity";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);
  if (diffMinutes < 1) {
    return "Refreshed just now";
  }
  if (diffMinutes < 60) {
    return `Last refreshed: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last refreshed: ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `Last refreshed: ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatSourceLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPayablesStatusBreakdown(rows: PayableRow[]) {
  const now = Date.now();
  const entries = [
    { key: "open", label: "Open", count: 0, color: "#315cff" },
    { key: "partial", label: "Partially Paid", count: 0, color: "#ff9a1a" },
    { key: "paid", label: "Paid", count: 0, color: "#21c16b" },
    { key: "overdue", label: "Overdue", count: 0, color: "#ff4f5e" },
  ];

  for (const row of rows) {
    if (row.balanceDue <= 0) {
      entries[2]!.count += 1;
      continue;
    }
    if (row.dueDate && row.dueDate.getTime() < now) {
      entries[3]!.count += 1;
      continue;
    }
    if (row.paidAmount > 0) {
      entries[1]!.count += 1;
      continue;
    }
    entries[0]!.count += 1;
  }

  return entries;
}

function getPaymentStatusBreakdown(rows: PaymentRow[]) {
  const entries = [
    { key: "pending", label: "Pending", count: 0, color: "#ff9a1a" },
    { key: "completed", label: "Completed", count: 0, color: "#21c16b" },
    { key: "failed", label: "Failed", count: 0, color: "#ff4f5e" },
  ];

  for (const row of rows) {
    if (row.status === PaymentStatus.PAID || row.status === PaymentStatus.PARTIALLY_PAID) {
      entries[1]!.count += 1;
      continue;
    }
    if (row.status === PaymentStatus.REJECTED || row.status === PaymentStatus.CANCELLED) {
      entries[2]!.count += 1;
      continue;
    }
    entries[0]!.count += 1;
  }

  return entries;
}

function getInvoiceAgingBreakdown(rows: PayableRow[]) {
  const entries = [
    { key: "0-30", label: "0-30 Days", count: 0, color: "#315cff" },
    { key: "31-60", label: "31-60 Days", count: 0, color: "#21c16b" },
    { key: "61-90", label: "61-90 Days", count: 0, color: "#ff9a1a" },
    { key: "90+", label: "90+ Days", count: 0, color: "#8a4dff" },
  ];

  const now = Date.now();
  for (const row of rows.filter((entry) => entry.balanceDue > 0)) {
    const ageDays = Math.max(Math.floor((now - row.invoiceDate.getTime()) / (1000 * 60 * 60 * 24)), 0);
    if (ageDays <= 30) {
      entries[0]!.count += 1;
    } else if (ageDays <= 60) {
      entries[1]!.count += 1;
    } else if (ageDays <= 90) {
      entries[2]!.count += 1;
    } else {
      entries[3]!.count += 1;
    }
  }

  return entries;
}

function getLedgerSourceMix(data: FinanceReportData["ledgerSummary"]["sourceTypeCounts"]) {
  const colors = ["#315cff", "#21c16b", "#ff9a1a", "#8a4dff", "#ff4f5e"];
  return data.map((entry, index) => ({
    key: entry.sourceType,
    label: formatSourceLabel(entry.sourceType),
    count: entry.count,
    color: colors[index % colors.length] ?? "#315cff",
  }));
}

function getInvoiceStatusBadge(status: string) {
  if (status === InvoiceStatus.PAID) {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === InvoiceStatus.PARTIALLY_PAID) {
    return "bg-[#fff4e5] text-[#e7881d]";
  }
  if (status === InvoiceStatus.APPROVED) {
    return "bg-[#edf3ff] text-[#315cff]";
  }
  if (status === InvoiceStatus.REJECTED || status === InvoiceStatus.CANCELLED) {
    return "bg-[#fff1f1] text-[#ff4f5e]";
  }
  return "bg-[#f4f6fb] text-[#6b7f9f]";
}

function getPaymentDirectionTone() {
  return "bg-[#f3eaff] text-[#8747f4]";
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

function OverviewDonutCard({
  title,
  total,
  entries,
}: {
  title: string;
  total: number;
  entries: Array<{ key: string; label: string; count: number; color: string }>;
}) {
  const gradient = buildDistributionGradient(entries);
  const safeTotal = total || 1;

  return (
    <article className="border-r border-[#edf2fb] px-5 py-5 last:border-r-0 xl:px-6">
      <h3 className="text-sm font-semibold text-[#173260]">{title}</h3>
      <div className="mt-5 flex items-center gap-5">
        <div className="relative grid h-28 w-28 place-items-center rounded-full" style={{ background: gradient }}>
          <div className="grid h-20 w-20 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
            <div>
              <p className="text-[1.6rem] font-semibold leading-none text-[#11244a]">{total}</p>
              <p className="mt-1 text-xs font-medium text-[#6f82a4]">Total</p>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          {entries.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-2.5">
                <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-[#173260]">{entry.label}</span>
              </div>
              <span className="text-[#6f82a4]">
                {entry.count} ({Math.round((entry.count / safeTotal) * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export default async function FinanceReportsPage({ searchParams }: FinanceReportsPageProps) {
  const session = await requirePermission("reports.read");
  const [params, canReadLedger, canReadInvoices, canReadVendorPayments, canExport] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "ledger.read"),
    hasPermission(session, "invoices.read"),
    hasPermission(session, "vendor_payments.read"),
    hasPermission(session, "reports.export"),
  ]);

  const q = getStringParam(params, "q");
  const invoiceStatus = Object.values(InvoiceStatus).find((value) => value === getStringParam(params, "invoiceStatus"));
  const paymentStatus = Object.values(PaymentStatus).find((value) => value === getStringParam(params, "paymentStatus"));
  const sourceType = Object.values(LedgerSourceType).find((value) => value === getStringParam(params, "sourceType"));
  const dateFrom = getStringParam(params, "dateFrom");
  const dateTo = getStringParam(params, "dateTo");

  const report = await getFinanceReportData(session, {
    q,
    invoiceStatus,
    paymentStatus,
    sourceType,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
  });

  const payablesStatus = getPayablesStatusBreakdown(report.payables);
  const paymentStatusBreakdown = getPaymentStatusBreakdown(report.paymentsMade);
  const invoiceAging = getInvoiceAgingBreakdown(report.payables);
  const ledgerSourceMix = getLedgerSourceMix(report.ledgerSummary.sourceTypeCounts);
  const recentVendorInvoices = report.payables.slice(0, 5);
  const cashMovementSnapshot = report.paymentsMade.slice(0, 5);
  const outstandingPayablesCount = report.payables.filter((row) => row.balanceDue > 0).length;
  const pendingVendorInvoicesCount = report.payables.filter((row) =>
    row.status === InvoiceStatus.DRAFT || row.status === InvoiceStatus.SUBMITTED || row.status === InvoiceStatus.APPROVAL_PENDING
  ).length;
  const reconciliationReviewCount = report.payables.filter((row) => row.paidAmount > 0 && row.balanceDue > 0).length;
  const failedPaymentsCount = report.paymentsMade.filter((row) => row.status === PaymentStatus.REJECTED || row.status === PaymentStatus.CANCELLED).length;
  const reportFiltersHref = buildFinanceReportsHref({
    q,
    invoiceStatus,
    paymentStatus,
    sourceType,
    dateFrom,
    dateTo,
  });
  const directoryCards = [
    {
      title: "Payables Report",
      description: "View outstanding payables and aging summary by vendor.",
      href: "#recent-vendor-invoices",
      iconColor: "text-[#315cff]",
      bgColor: "bg-[#edf3ff]",
    },
    {
      title: "Cash Movement Report",
      description: "Track cash outflows and payment activity across periods.",
      href: "#cash-movement-snapshot",
      iconColor: "text-[#21c16b]",
      bgColor: "bg-[#ecfbf2]",
    },
    {
      title: "Ledger Summary",
      description: "Review debit, credit, and source mix in posted ledger entries.",
      href: canReadLedger ? "/ledger" : "#finance-overview",
      iconColor: "text-[#8a4dff]",
      bgColor: "bg-[#f3eaff]",
    },
    {
      title: "Vendor Payment Summary",
      description: "Summary of payments made to vendors and obligations.",
      href: canReadVendorPayments ? "/vendor-payments" : "#cash-movement-snapshot",
      iconColor: "text-[#ff9a1a]",
      bgColor: "bg-[#fff4e5]",
    },
    {
      title: "Invoice Payment Summary",
      description: "Monitor invoice settlements and outstanding balances.",
      href: canReadInvoices ? "/invoices" : "#recent-vendor-invoices",
      iconColor: "text-[#315cff]",
      bgColor: "bg-[#edf3ff]",
    },
    {
      title: "Export History",
      description: "Download the latest finance export configurations and snapshots.",
      href: canExport ? reportFiltersHref : "#report-filters",
      iconColor: "text-[#21c16b]",
      bgColor: "bg-[#ecfbf2]",
    },
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Finance Reports</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Cross-tenant financial insights, payables, payments, and ledger summaries.
          </p>
        </div>

        <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeRefresh(report.latestUpdatedAt)}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="6" y="4" width="12" height="16" rx="2.5" />
              <path d="M9 8h6M9 12h6M9 16h6" />
            </svg>
          }
          title="Total Vendor Invoice Amount"
          value={formatCurrencyInr(report.summary.totalVendorInvoiceAmount)}
          subtitle="All companies"
          trend={`${report.payables.length} invoices`}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="4.5" y="7" width="15" height="10" rx="2" />
              <path d="M8 12h4" />
            </svg>
          }
          title="Total Payments Made"
          value={formatCurrencyInr(report.summary.totalInvoicePaymentsMade)}
          subtitle="All companies"
          trend={`${paymentStatusBreakdown.find((entry) => entry.key === "completed")?.count ?? 0} completed`}
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M7 4h7l4 4v12H7z" />
              <path d="M14 4v4h4" />
              <path d="M9 13h6M9 17h4" />
            </svg>
          }
          title="Outstanding Payables"
          value={formatCurrencyInr(report.summary.outstandingPayables)}
          subtitle="All companies"
          trend={`${outstandingPayablesCount} open`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="9" cy="8" r="3" />
              <circle cx="17" cy="16" r="3" />
              <path d="M9 11v6M12 17h2" />
            </svg>
          }
          title="Standalone Vendor Payments"
          value={formatCurrencyInr(report.summary.totalStandaloneVendorPayments)}
          subtitle="All companies"
          trend={`${report.paymentsMade.filter((row) => row.sourceLabel === "Vendor Payment").length} records`}
          trendTone="bg-[#ecfbf2] text-[#1d9d57]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
              <rect x="4" y="6" width="6" height="12" rx="2" />
            </svg>
          }
          title="Total Outgoing Payments"
          value={formatCurrencyInr(report.summary.totalOutgoingPayments)}
          subtitle="All companies"
          trend={`${report.paymentsMade.length} disbursements`}
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M7 4h10v16H7z" />
              <path d="M10 8h4M10 12h4M10 16h4" />
            </svg>
          }
          title="Ledger Entries"
          value={report.summary.ledgerEntriesCount.toLocaleString("en-IN")}
          subtitle="All companies"
          trend={formatCurrencyInr(report.ledgerSummary.totalDebit)}
          trendTone="bg-[#fff1f1] text-[#ff4f5e]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.9fr)_420px]">
        <div className="space-y-5">
          <div id="finance-overview" className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Financial Overview</h2>
            </div>
            <div className="grid gap-0 xl:grid-cols-4">
              <OverviewDonutCard title="Payables Status" total={report.payables.length} entries={payablesStatus} />
              <OverviewDonutCard title="Payment Status" total={report.paymentsMade.length} entries={paymentStatusBreakdown} />
              <OverviewDonutCard title="Vendor Invoice Aging" total={report.payables.filter((row) => row.balanceDue > 0).length} entries={invoiceAging} />
              <OverviewDonutCard title="Ledger Source Mix" total={report.ledgerSummary.entriesCount} entries={ledgerSourceMix} />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <div id="recent-vendor-invoices" className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
              <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
                <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent Vendor Invoices</h2>
                {canReadInvoices ? (
                  <PrefetchLink href="/invoices" className="text-sm font-semibold text-[#315cff]">
                    View all
                  </PrefetchLink>
                ) : (
                  <span className="text-sm font-semibold text-[#93a2bf]">Permission required</span>
                )}
              </div>
              <div className="hidden xl:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-4 py-3">Invoice No.</th>
                      <th className="px-4 py-3">Vendor</th>
                      <th className="px-4 py-3">Company</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Received Date</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {recentVendorInvoices.map((row) => (
                      <tr key={row.id} className="transition hover:bg-[#fbfcff]">
                        <td className="px-4 py-4 text-sm font-semibold text-[#315cff]">{row.vendorInvoiceNumber}</td>
                        <td className="px-4 py-4 text-sm text-[#173260]">{row.vendor.name}</td>
                        <td className="px-4 py-4 text-sm text-[#6f82a4]">{row.servicePartner.name}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getInvoiceStatusBadge(row.status)}`}>{formatSourceLabel(row.status)}</span>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#173260]">{formatCurrencyInr(row.grandTotal)}</td>
                        <td className="px-4 py-4 text-sm text-[#6f82a4]">{formatShortDateTime(row.receivedDate)}</td>
                        <td className="px-4 py-4 text-right">
                          <PrefetchLink href={canReadInvoices ? `/invoices/${row.id}` : "#"} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[#dfe6f2] text-[#315cff]">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                              <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          </PrefetchLink>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 p-4 xl:hidden">
                {recentVendorInvoices.map((row) => (
                  <article key={row.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#122449]">{row.vendorInvoiceNumber}</p>
                        <p className="mt-1 text-xs text-[#8092b2]">{row.vendor.name}</p>
                        <p className="mt-1 text-xs text-[#8092b2]">{row.servicePartner.name}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getInvoiceStatusBadge(row.status)}`}>{formatSourceLabel(row.status)}</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-[#6f82a4]">{formatShortDateTime(row.receivedDate)}</span>
                      <span className="font-semibold text-[#173260]">{formatCurrencyInr(row.grandTotal)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div id="cash-movement-snapshot" className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
              <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
                <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Cash Movement Snapshot</h2>
                {canReadVendorPayments ? (
                  <PrefetchLink href="/vendor-payments" className="text-sm font-semibold text-[#315cff]">
                    View all
                  </PrefetchLink>
                ) : (
                  <span className="text-sm font-semibold text-[#93a2bf]">Permission required</span>
                )}
              </div>
              <div className="hidden xl:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3 text-right">Direction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {cashMovementSnapshot.map((row) => (
                      <tr key={row.id} className="transition hover:bg-[#fbfcff]">
                        <td className="px-4 py-4 text-sm text-[#173260]">{formatShortDate(row.paidAt)}</td>
                        <td className="px-4 py-4 text-sm text-[#173260]">{row.sourceLabel}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#315cff]">{row.paymentNumber}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#173260]">{formatCurrencyInr(row.amount)}</td>
                        <td className="px-4 py-4 text-right">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getPaymentDirectionTone()}`}>Outgoing</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 p-4 xl:hidden">
                {cashMovementSnapshot.map((row) => (
                  <article key={row.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[#122449]">{row.paymentNumber}</p>
                        <p className="mt-1 text-xs text-[#8092b2]">{row.sourceLabel}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getPaymentDirectionTone()}`}>Outgoing</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between text-sm">
                      <span className="text-[#6f82a4]">{formatShortDate(row.paidAt)}</span>
                      <span className="font-semibold text-[#173260]">{formatCurrencyInr(row.amount)}</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Report Shortcuts</h2>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {canReadLedger ? (
                <PrefetchLink href="/ledger" className="flex items-center gap-3 rounded-2xl border border-[#e2e9f6] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:bg-[#fbfcff]">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f3eaff] text-[#8a4dff]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M7 4h10v16H7z" />
                      <path d="M10 8h4M10 12h4M10 16h4" />
                    </svg>
                  </span>
                  View Ledger
                </PrefetchLink>
              ) : null}
              <PrefetchLink href="#recent-vendor-invoices" className="flex items-center gap-3 rounded-2xl border border-[#e2e9f6] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:bg-[#fbfcff]">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#fff4e5] text-[#ff9a1a]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M7 4h7l4 4v12H7z" />
                    <path d="M14 4v4h4" />
                  </svg>
                </span>
                Payables Report
              </PrefetchLink>
              <PrefetchLink href="#cash-movement-snapshot" className="flex items-center gap-3 rounded-2xl border border-[#e2e9f6] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:bg-[#fbfcff]">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#edf3ff] text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <rect x="5" y="3" width="14" height="18" rx="2.5" />
                    <path d="M8 8h8M8 12h8M8 16h6" />
                  </svg>
                </span>
                Cash Movement
              </PrefetchLink>
              {canExport ? (
                <PrefetchLink href="#report-filters" className="flex items-center gap-3 rounded-2xl border border-[#e2e9f6] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:bg-[#fbfcff]">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ecfbf2] text-[#21c16b]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M12 4v10" />
                      <path d="m8 10 4 4 4-4" />
                      <path d="M5 20h14" />
                    </svg>
                  </span>
                  Export Finance Report
                </PrefetchLink>
              ) : null}
              {canReadInvoices ? (
                <PrefetchLink href="/invoices" className="flex items-center gap-3 rounded-2xl border border-[#e2e9f6] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:bg-[#fbfcff]">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#edf3ff] text-[#315cff]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <rect x="6" y="4" width="12" height="16" rx="2.5" />
                      <path d="M9 8h6M9 12h6M9 16h6" />
                    </svg>
                  </span>
                  View Vendor Invoices
                </PrefetchLink>
              ) : null}
              {canReadVendorPayments ? (
                <PrefetchLink href="/vendor-payments" className="flex items-center gap-3 rounded-2xl border border-[#e2e9f6] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:bg-[#fbfcff]">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#ecfbf2] text-[#21c16b]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <circle cx="12" cy="12" r="8" />
                      <path d="M12 8v8M8 12h8" />
                    </svg>
                  </span>
                  View Vendor Payments
                </PrefetchLink>
              ) : null}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Alerts / Pending Actions</h2>
              <PrefetchLink href="#report-filters" className="text-sm font-semibold text-[#315cff]">
                View all
              </PrefetchLink>
            </div>
            <div className="space-y-1 px-4 py-4">
              {[
                {
                  label: "Outstanding Payables",
                  sublabel: "Payments pending to vendors",
                  count: outstandingPayablesCount,
                  tone: "bg-[#fff1f1] text-[#ff4f5e]",
                },
                {
                  label: "Pending Vendor Invoices",
                  sublabel: "Invoices awaiting approval",
                  count: pendingVendorInvoicesCount,
                  tone: "bg-[#fff4e5] text-[#e7881d]",
                },
                {
                  label: "Reconciliation Review",
                  sublabel: "Items pending reconciliation",
                  count: reconciliationReviewCount,
                  tone: "bg-[#f3eaff] text-[#8a4dff]",
                },
                {
                  label: "Failed Payments",
                  sublabel: "Payments that require attention",
                  count: failedPaymentsCount,
                  tone: "bg-[#fff1f1] text-[#ff4f5e]",
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3 rounded-2xl px-2 py-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-full ${item.tone}`}>
                    <span className="text-sm font-semibold">{item.count}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#122449]">{item.label}</p>
                    <p className="text-xs text-[#8092b2]">{item.sublabel}</p>
                  </div>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </div>
              ))}
            </div>
          </div>

          <div id="report-filters" className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Report Filters</h2>
            </div>
            <form action="" className="grid gap-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Date From</span>
                  <input
                    type="date"
                    name="dateFrom"
                    defaultValue={formatInputDate(dateFrom ?? undefined)}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Date To</span>
                  <input
                    type="date"
                    name="dateTo"
                    defaultValue={formatInputDate(dateTo ?? undefined)}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Invoice Status</span>
                  <select
                    name="invoiceStatus"
                    defaultValue={invoiceStatus ?? ""}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  >
                    <option value="">All Statuses</option>
                    {Object.values(InvoiceStatus).map((value) => (
                      <option key={value} value={value}>
                        {formatSourceLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Payment Status</span>
                  <select
                    name="paymentStatus"
                    defaultValue={paymentStatus ?? ""}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  >
                    <option value="">All Statuses</option>
                    {Object.values(PaymentStatus).map((value) => (
                      <option key={value} value={value}>
                        {formatSourceLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Ledger Source</span>
                  <select
                    name="sourceType"
                    defaultValue={sourceType ?? ""}
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  >
                    <option value="">All Sources</option>
                    {Object.values(LedgerSourceType).map((value) => (
                      <option key={value} value={value}>
                        {formatSourceLabel(value)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Export Format</span>
                  <select
                    name="exportFormat"
                    defaultValue="pdf"
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  >
                    <option value="pdf">PDF</option>
                    <option value="csv">CSV</option>
                    <option value="xlsx">XLSX</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Search</span>
                <div className="relative">
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder="Search by vendor, invoice, ref..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </div>
              </label>

              <div className="flex items-center justify-between gap-3">
                <PrefetchLink href="/finance-reports" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-6 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)]">
                  Apply Filters
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <div className="border-b border-[#edf2fb] px-5 py-4">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Finance Report Directory</h2>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-6">
          {directoryCards.map((card) => (
            <PrefetchLink key={card.title} href={card.href} className="group rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(23,52,110,0.08)]">
              <div className={`grid h-14 w-14 place-items-center rounded-[18px] ${card.bgColor} ${card.iconColor}`}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <rect x="6" y="4" width="12" height="16" rx="2.5" />
                  <path d="M9 8h6M9 12h6M9 16h4" />
                </svg>
              </div>
              <div className="mt-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#122449]">{card.title}</h3>
                  <p className="mt-2 text-xs leading-5 text-[#7b8daa]">{card.description}</p>
                </div>
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-[#8ea0bf] transition group-hover:text-[#315cff]" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </div>
            </PrefetchLink>
          ))}
        </div>
      </div>
    </section>
  );
}
