import { InvoiceStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatCurrencyInr, formatDateTime, formatEnumLabel } from "@/lib/utils/format";

type InvoiceSummaryCardProps = {
  invoice: {
    vendorInvoiceNumber: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    invoiceDate: Date;
    receivedDate: Date;
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
  paidAmount?: number;
  balanceDue?: number;
  paymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID";
};

export function InvoiceSummaryCard({ invoice, paidAmount, balanceDue, paymentStatus }: InvoiceSummaryCardProps) {
  const paidValue = typeof paidAmount === "number" ? paidAmount : 0;
  const balanceValue = typeof balanceDue === "number" ? balanceDue : Number(invoice.grandTotal);
  return (
    <div className="crm-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6f84ab]">Received Invoice Summary</h3>
        <StatusBadge value={invoice.status} />
      </div>
      <p className="text-base font-semibold text-[#10254b]">{invoice.vendorInvoiceNumber}</p>
      <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
        <p>Internal Record No.: {invoice.invoiceNumber}</p>
        <p>Invoice Date: {formatDateTime(invoice.invoiceDate)}</p>
        <p>Received Date: {formatDateTime(invoice.receivedDate)}</p>
        <p>Due Date: {formatDateTime(invoice.dueDate)}</p>
        <p>Lines: {invoice._count.items}</p>
        <p>Subtotal: {formatCurrencyInr(invoice.subtotal)}</p>
        <p>Tax Total: {formatCurrencyInr(invoice.taxTotal)}</p>
        <p className="font-medium text-slate-700">Grand Total: {formatCurrencyInr(invoice.grandTotal)}</p>
        <p>Payments Made: {formatCurrencyInr(paidValue)}</p>
        <p>Balance Due: {formatCurrencyInr(balanceValue)}</p>
        {paymentStatus ? <p>Payment Status: {formatEnumLabel(paymentStatus)}</p> : null}
        <p>Created: {formatDateTime(invoice.createdAt)}</p>
        <p>Updated: {formatDateTime(invoice.updatedAt)}</p>
      </div>
    </div>
  );
}
