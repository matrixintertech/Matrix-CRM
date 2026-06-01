import { PaymentStatus } from "@prisma/client";

import { updatePaymentStatusAction } from "@/features/payments/actions/payment.actions";

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

type PaymentStatusActionsProps = {
  paymentId: string;
  currentStatus: PaymentStatus;
  redirectTo: string;
};

export function PaymentStatusActions({ paymentId, currentStatus, redirectTo }: PaymentStatusActionsProps) {
  return (
    <form action={updatePaymentStatusAction.bind(null, paymentId)} className="flex items-center gap-2">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select
        name="status"
        defaultValue={currentStatus}
        className="h-8 rounded-md border border-[var(--border)] px-2 text-xs"
      >
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
