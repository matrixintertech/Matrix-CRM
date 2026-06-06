import { PaymentStatus } from "@prisma/client";

import { updateVendorPaymentStatusAction } from "@/features/vendor-payments/actions/vendor-payment.actions";

const statusOptions: PaymentStatus[] = [
  PaymentStatus.DRAFT,
  PaymentStatus.REQUESTED,
  PaymentStatus.APPROVAL_PENDING,
  PaymentStatus.APPROVED,
  PaymentStatus.REJECTED,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.PAID,
  PaymentStatus.CANCELLED,
];

type VendorPaymentStatusActionsProps = {
  vendorPaymentId: string;
  currentStatus: PaymentStatus;
  redirectTo: string;
};

export function VendorPaymentStatusActions({
  vendorPaymentId,
  currentStatus,
  redirectTo,
}: VendorPaymentStatusActionsProps) {
  return (
    <form action={updateVendorPaymentStatusAction.bind(null, vendorPaymentId)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select name="status" defaultValue={currentStatus} className="h-10 rounded-xl border border-[var(--border)] px-3 text-sm">
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button type="submit" className="min-h-10 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium">
        Save
      </button>
    </form>
  );
}
