import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatCurrencyInr, formatDateTime } from "@/lib/utils/format";

type PayableRow = {
  id: string;
  paymentNumber: string;
  amount: number;
  status: string;
  paidAt: Date | null;
  sourceLabel: string;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
  purchaseOrder: {
    id: string;
    poNumber: string;
  } | null;
  vendorInvoiceNumber: string | null;
  invoiceNumber: string | null;
};

export function PayablesReport({ rows }: { rows: PayableRow[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-lg font-semibold">Outgoing Payments</h2>
        <p className="text-sm text-[var(--muted)]">Payments made against vendor invoices and other vendor obligations.</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[var(--muted)]">No outgoing payments found.</p>
      ) : (
        <>
          <div className="space-y-3 p-4 md:hidden">
            {rows.map((row) => (
              <article key={row.id} className="rounded-2xl border border-[var(--border)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{row.paymentNumber}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{row.sourceLabel}</p>
                  </div>
                  <StatusBadge value={row.status} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Vendor</p>
                    <p className="mt-1 text-sm text-slate-900">{row.vendor.name} ({row.vendor.code})</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Date</p>
                    <p className="mt-1 text-sm text-slate-900">{row.paidAt ? formatDateTime(row.paidAt) : "-"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Amount</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrencyInr(row.amount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Purchase Order</p>
                    <div className="mt-1 text-sm text-slate-900">
                      {row.purchaseOrder ? (
                        <Link href={`/purchase-orders/${row.purchaseOrder.id}`} className="text-[var(--primary)] underline">
                          {row.purchaseOrder.poNumber}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="crm-scroll-shell hidden md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Vendor Invoice</th>
                <th className="px-4 py-3">Purchase Order</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-900">
                      {row.paymentNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.sourceLabel}</td>
                  <td className="px-4 py-3">
                    {row.vendor.name} ({row.vendor.code})
                  </td>
                  <td className="px-4 py-3">
                    {row.vendorInvoiceNumber ? (
                      <div>
                        <p>{row.vendorInvoiceNumber}</p>
                        {row.invoiceNumber ? <p className="text-xs text-[var(--muted)]">Internal: {row.invoiceNumber}</p> : null}
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {row.purchaseOrder ? (
                      <Link href={`/purchase-orders/${row.purchaseOrder.id}`} className="text-[var(--primary)] underline">
                        {row.purchaseOrder.poNumber}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-4 py-3">{row.paidAt ? formatDateTime(row.paidAt) : "-"}</td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.amount)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}
