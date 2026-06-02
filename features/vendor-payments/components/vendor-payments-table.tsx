import Link from "next/link";
import { PaymentStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { deleteVendorPaymentAction } from "@/features/vendor-payments/actions/vendor-payment.actions";
import { VendorPaymentStatusActions } from "@/features/vendor-payments/components/vendor-payment-status-actions";
import { formatDateTime } from "@/lib/utils/format";

type VendorPaymentRow = {
  id: string;
  paymentNumber: string;
  status: PaymentStatus;
  amount: unknown;
  paidAt: Date | null;
  updatedAt: Date;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
  purchaseOrder?: {
    id: string;
    poNumber: string;
    status?: string;
  } | null;
  requestedBy?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

type VendorPaymentsTableProps = {
  vendorPayments: VendorPaymentRow[];
  redirectTo: string;
  canUpdate: boolean;
  canDelete: boolean;
  canStatusUpdate: boolean;
  showActions?: boolean;
};

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

function userLabel(user: VendorPaymentRow["requestedBy"]) {
  if (!user) {
    return "-";
  }
  return user.name?.trim() || user.email || user.phone || "-";
}

export function VendorPaymentsTable({
  vendorPayments,
  redirectTo,
  canUpdate,
  canDelete,
  canStatusUpdate,
  showActions = true,
}: VendorPaymentsTableProps) {
  if (vendorPayments.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No vendor payments recorded yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
          <tr>
            <th className="px-3 py-2">Payment</th>
            <th className="px-3 py-2">Vendor</th>
            <th className="px-3 py-2">PO</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Amount</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Requested By</th>
            {showActions ? <th className="px-3 py-2">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {vendorPayments.map((vendorPayment) => (
            <tr key={vendorPayment.id} className="border-t border-[var(--border)]">
              <td className="px-3 py-2">
                <Link href={`/vendor-payments/${vendorPayment.id}`} className="font-medium text-[var(--primary)] underline">
                  {vendorPayment.paymentNumber}
                </Link>
                <p className="text-xs text-[var(--muted)]">Updated {formatDateTime(vendorPayment.updatedAt)}</p>
              </td>
              <td className="px-3 py-2">
                {vendorPayment.vendor.name} ({vendorPayment.vendor.code})
              </td>
              <td className="px-3 py-2">
                {vendorPayment.purchaseOrder ? (
                  <Link href={`/purchase-orders/${vendorPayment.purchaseOrder.id}`} className="text-[var(--primary)] underline">
                    {vendorPayment.purchaseOrder.poNumber}
                  </Link>
                ) : (
                  "-"
                )}
              </td>
              <td className="px-3 py-2">{formatDateTime(vendorPayment.paidAt)}</td>
              <td className="px-3 py-2">{toMoney(vendorPayment.amount)}</td>
              <td className="px-3 py-2">
                <StatusBadge value={vendorPayment.status} />
              </td>
              <td className="px-3 py-2">{userLabel(vendorPayment.requestedBy)}</td>
              {showActions ? (
                <td className="px-3 py-2">
                  <div className="space-y-2">
                    {canStatusUpdate ? (
                      <VendorPaymentStatusActions
                        vendorPaymentId={vendorPayment.id}
                        currentStatus={vendorPayment.status}
                        redirectTo={redirectTo}
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {canUpdate ? (
                        <Link href={`/vendor-payments/${vendorPayment.id}/edit`} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium">
                          Edit
                        </Link>
                      ) : null}
                      {canDelete ? (
                        <form action={deleteVendorPaymentAction.bind(null, vendorPayment.id)}>
                          <input type="hidden" name="redirectTo" value={redirectTo} />
                          <button type="submit" className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">
                            Void
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
