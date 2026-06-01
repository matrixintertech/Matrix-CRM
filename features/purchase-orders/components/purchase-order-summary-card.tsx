import { PurchaseOrderStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

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

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

export function PurchaseOrderSummaryCard({ purchaseOrder }: PurchaseOrderSummaryCardProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">PO Summary</h3>
        <StatusBadge value={purchaseOrder.status} />
      </div>
      <p className="text-sm font-medium">{purchaseOrder.poNumber}</p>
      <div className="mt-2 space-y-1 text-xs text-[var(--muted)]">
        <p>Order Date: {formatDateTime(purchaseOrder.orderDate)}</p>
        <p>Expected Date: {formatDateTime(purchaseOrder.expectedDate)}</p>
        <p>Lines: {purchaseOrder._count.items}</p>
        <p>Subtotal: {toMoney(purchaseOrder.subtotal)}</p>
        <p>Tax Total: {toMoney(purchaseOrder.taxTotal)}</p>
        <p className="font-medium text-slate-700">Grand Total: {toMoney(purchaseOrder.grandTotal)}</p>
        <p>Created: {formatDateTime(purchaseOrder.createdAt)}</p>
        <p>Updated: {formatDateTime(purchaseOrder.updatedAt)}</p>
      </div>
    </div>
  );
}
