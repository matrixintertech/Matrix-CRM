import { PurchaseOrderStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatCurrencyInr, formatDateTime } from "@/lib/utils/format";

type PurchaseOrderSummaryCardProps = {
  purchaseOrder: {
    poNumber: string;
    status: PurchaseOrderStatus;
    orderDate: Date;
    expectedDate: Date | null;
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

export function PurchaseOrderSummaryCard({ purchaseOrder }: PurchaseOrderSummaryCardProps) {
  return (
    <div className="crm-panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6f84ab]">PO Summary</h3>
        <StatusBadge value={purchaseOrder.status} />
      </div>
      <p className="text-base font-semibold text-[#10254b]">{purchaseOrder.poNumber}</p>
      <div className="mt-3 space-y-2 text-sm text-[var(--muted)]">
        <p>Order Date: {formatDateTime(purchaseOrder.orderDate)}</p>
        <p>Expected Date: {formatDateTime(purchaseOrder.expectedDate)}</p>
        <p>Lines: {purchaseOrder._count.items}</p>
        <p>Subtotal: {formatCurrencyInr(purchaseOrder.subtotal)}</p>
        <p>Tax Total: {formatCurrencyInr(purchaseOrder.taxTotal)}</p>
        <p className="font-medium text-slate-700">Grand Total: {formatCurrencyInr(purchaseOrder.grandTotal)}</p>
        <p>Created: {formatDateTime(purchaseOrder.createdAt)}</p>
        <p>Updated: {formatDateTime(purchaseOrder.updatedAt)}</p>
      </div>
    </div>
  );
}
