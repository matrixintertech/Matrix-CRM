import { PurchaseOrderStatus } from "@prisma/client";

import {
  deletePurchaseOrderAction,
  updatePurchaseOrderStatusAction,
} from "@/features/purchase-orders/actions/purchase-order.actions";

type PurchaseOrderStatusActionsProps = {
  purchaseOrderId: string;
  currentStatus: PurchaseOrderStatus;
  canDelete: boolean;
};

const statusOptions: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.APPROVAL_PENDING,
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.REJECTED,
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_FULFILLED,
  PurchaseOrderStatus.FULFILLED,
  PurchaseOrderStatus.CANCELLED,
];

export function PurchaseOrderStatusActions({
  purchaseOrderId,
  currentStatus,
  canDelete,
}: PurchaseOrderStatusActionsProps) {
  return (
    <div className="space-y-2">
      <form action={updatePurchaseOrderStatusAction.bind(null, purchaseOrderId)} className="space-y-2">
        <input type="hidden" name="redirectTo" value={`/purchase-orders/${purchaseOrderId}`} />
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={currentStatus} className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          Save status
        </button>
      </form>

      {canDelete ? (
        <form action={deletePurchaseOrderAction.bind(null, purchaseOrderId)}>
          <input type="hidden" name="redirectTo" value="/purchase-orders" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
