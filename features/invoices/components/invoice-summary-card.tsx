import { InvoiceStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type InvoiceSummaryCardProps = {
  invoice: {
    invoiceNumber: string;
    status: InvoiceStatus;
    invoiceDate: Date;
    dueDate: Date | null;
    subtotal: unknown;
    taxTotal: unknown;
    grandTotal: unknown;
    createdAt: Date;
    updatedAt: Date;
    _count: {
      items: number;
    };
  };
};

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

export function InvoiceSummaryCard({ invoice }: InvoiceSummaryCardProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Invoice Summary</h3>
        <StatusBadge value={invoice.status} />
      </div>
      <p className="text-sm font-medium">{invoice.invoiceNumber}</p>
      <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
        <p>Invoice Date: {formatDateTime(invoice.invoiceDate)}</p>
        <p>Due Date: {formatDateTime(invoice.dueDate)}</p>
        <p>Lines: {invoice._count.items}</p>
        <p>Subtotal: {toMoney(invoice.subtotal)}</p>
        <p>Tax Total: {toMoney(invoice.taxTotal)}</p>
        <p className="font-medium text-slate-700">Grand Total: {toMoney(invoice.grandTotal)}</p>
        <p>Balance Due: {toMoney(invoice.grandTotal)}</p>
        <p>Created: {formatDateTime(invoice.createdAt)}</p>
        <p>Updated: {formatDateTime(invoice.updatedAt)}</p>
      </div>
    </div>
  );
}
