import Link from "next/link";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatCurrencyInr, formatDateTime, formatOptional } from "@/lib/utils/format";

type ReceivableRow = {
  id: string;
  vendorInvoiceNumber: string;
  invoiceNumber: string;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
  purchaseOrder: {
    id: string;
    poNumber: string;
  } | null;
  status: string;
  invoiceDate: Date;
  receivedDate: Date;
  dueDate: Date | null;
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
};

export function ReceivablesReport({ rows }: { rows: ReceivableRow[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-lg font-semibold">Received Vendor Invoices</h2>
        <p className="text-sm text-[var(--muted)]">Recorded vendor invoices with paid and outstanding payable balances.</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[var(--muted)]">No vendor invoices found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Vendor Invoice</th>
                <th className="px-4 py-3">Internal Record</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">PO</th>
                <th className="px-4 py-3">Invoice Date</th>
                <th className="px-4 py-3">Received Date</th>
                <th className="px-4 py-3">Due Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Grand Total</th>
                <th className="px-4 py-3">Payments Made</th>
                <th className="px-4 py-3">Balance Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">
                    <Link href={`/invoices/${row.id}`} className="font-medium text-[var(--primary)] underline">
                      {row.vendorInvoiceNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.invoiceNumber}</td>
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
                  <td className="px-4 py-3">{formatDateTime(row.invoiceDate)}</td>
                  <td className="px-4 py-3">{formatDateTime(row.receivedDate)}</td>
                  <td className="px-4 py-3">{formatOptional(row.dueDate ? formatDateTime(row.dueDate) : null)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.grandTotal)}</td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.paidAmount)}</td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.balanceDue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
