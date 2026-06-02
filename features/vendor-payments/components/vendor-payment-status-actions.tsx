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
    <form action={updateVendorPaymentStatusAction.bind(null, vendorPaymentId)} className="flex items-center gap-2">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select name="status" defaultValue={currentStatus} className="h-8 rounded-md border border-[var(--border)] px-2 text-xs">
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium">
        Save
      </button>
    </form>
  );
}
