import { ApprovalStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type QuotationSummaryCardProps = {
  quotations: Array<{
    id: string;
    quotationNumber: string;
    status: ApprovalStatus;
    subtotal: number;
    taxTotal: number;
    grandTotal: number;
    validUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
};

export function QuotationSummaryCard({ quotations }: QuotationSummaryCardProps) {
  if (quotations.length === 0) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Quotation Summary</h3>
        <p className="text-sm text-[var(--muted)]">No quotations created yet.</p>
      </div>
    );
  }

  const latest = quotations[0];
  if (!latest) {
    return null;
  }
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Quotation Summary</h3>
        <StatusBadge value={latest.status} />
      </div>
      <p className="text-sm font-medium">{latest.quotationNumber}</p>
      <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
        <p>Subtotal: ₹{latest.subtotal.toFixed(2)}</p>
        <p>Tax: ₹{latest.taxTotal.toFixed(2)}</p>
        <p className="font-semibold text-slate-800">Total: ₹{latest.grandTotal.toFixed(2)}</p>
        <p>Valid Until: {formatDateTime(latest.validUntil)}</p>
        <p>Updated: {formatDateTime(latest.updatedAt)}</p>
      </div>
    </div>
  );
}
