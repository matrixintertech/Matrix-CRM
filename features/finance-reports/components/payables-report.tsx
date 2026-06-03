import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatCurrencyInr, formatDateTime } from "@/lib/utils/format";

type PayableRow = {
  id: string;
  paymentNumber: string;
  amount: number;
  status: string;
  paidAt: Date | null;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
  purchaseOrder: {
    id: string;
    poNumber: string;
  } | null;
};

export function PayablesReport({ rows }: { rows: PayableRow[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-lg font-semibold">Payables</h2>
        <p className="text-sm text-[var(--muted)]">Vendor payment activity with linked purchase orders.</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[var(--muted)]">No vendor payments found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Vendor</th>
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
                    <Link href={`/vendor-payments/${row.id}`} className="font-medium text-[var(--primary)] underline">
                      {row.paymentNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {row.vendor.name} ({row.vendor.code})
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
      )}
    </section>
  );
}
