"use client";

import { InvoiceStatus, LedgerSourceType, PaymentStatus } from "@prisma/client";

type FinanceReportFiltersProps = {
  q?: string;
  invoiceStatus?: InvoiceStatus;
  paymentStatus?: PaymentStatus;
  sourceType?: LedgerSourceType;
  dateFrom?: string;
  dateTo?: string;
};

export function FinanceReportFilters({
  q,
  invoiceStatus,
  paymentStatus,
  sourceType,
  dateFrom,
  dateTo,
}: FinanceReportFiltersProps) {
  return (
    <form method="get" className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-sm">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="space-y-1 text-sm xl:col-span-2">
          <span className="font-medium">Search</span>
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Vendor invoice, payment, vendor, or PO"
            className="h-10 w-full rounded-xl border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Invoice Status</span>
          <select name="invoiceStatus" defaultValue={invoiceStatus ?? ""} className="h-10 w-full rounded-xl border border-[var(--border)] px-3">
            <option value="">All</option>
            {Object.values(InvoiceStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Payment Status</span>
          <select name="paymentStatus" defaultValue={paymentStatus ?? ""} className="h-10 w-full rounded-xl border border-[var(--border)] px-3">
            <option value="">All</option>
            {Object.values(PaymentStatus).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Ledger Source</span>
          <select name="sourceType" defaultValue={sourceType ?? ""} className="h-10 w-full rounded-xl border border-[var(--border)] px-3">
            <option value="">All</option>
            {Object.values(LedgerSourceType).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">From</span>
          <input type="date" name="dateFrom" defaultValue={dateFrom ?? ""} className="h-10 w-full rounded-xl border border-[var(--border)] px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">To</span>
          <input type="date" name="dateTo" defaultValue={dateTo ?? ""} className="h-10 w-full rounded-xl border border-[var(--border)] px-3" />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button type="submit" className="rounded-xl bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(47,94,248,0.16)]">
          Apply
        </button>
        <a href="/finance-reports" className="rounded-xl border border-[var(--border)] px-4 py-3 text-center text-sm font-medium">
          Reset
        </a>
      </div>
    </form>
  );
}
