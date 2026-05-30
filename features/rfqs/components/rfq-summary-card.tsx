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
    <div className="rounded-md border border-[var(--border)] bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">RFQ Summary</h3>
        <StatusBadge value={rfq.status} />
      </div>
      <p className="text-sm font-medium">{rfq.rfqNumber}</p>
      <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
        <p>Due Date: {formatDateTime(rfq.dueDate)}</p>
        <p>Lines: {rfq._count.items}</p>
        <p>Vendors: {rfq._count.vendorQuotes}</p>
        <p>Created: {formatDateTime(rfq.createdAt)}</p>
        <p>Updated: {formatDateTime(rfq.updatedAt)}</p>
      </div>
    </div>
  );
}
