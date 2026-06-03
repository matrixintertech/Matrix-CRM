import { RfqStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type RfqSummaryCardProps = {
  rfq: {
    id: string;
    rfqNumber: string;
    status: RfqStatus;
    dueDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count: {
      items: number;
      vendorQuotes: number;
    };
  };
};

export function RfqSummaryCard({ rfq }: RfqSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6f84ab]">RFQ Summary</h3>
        <StatusBadge value={rfq.status} />
      </div>
      <p className="text-base font-semibold text-[#10254b]">{rfq.rfqNumber}</p>
      <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
        <p>Due Date: {formatDateTime(rfq.dueDate)}</p>
        <p>Lines: {rfq._count.items}</p>
        <p>Vendors: {rfq._count.vendorQuotes}</p>
        <p>Created: {formatDateTime(rfq.createdAt)}</p>
        <p>Updated: {formatDateTime(rfq.updatedAt)}</p>
      </div>
    </div>
  );
}
