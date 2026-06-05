import { PaymentStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { deletePaymentAction, updatePaymentAction } from "@/features/payments/actions/payment.actions";
import { PaymentForm } from "@/features/payments/components/payment-form";
import { PaymentStatusActions } from "@/features/payments/components/payment-status-actions";
import { formatDateTime } from "@/lib/utils/format";

type PaymentRow = {
  id: string;
  paymentNumber: string;
  status: PaymentStatus;
  amount: unknown;
  mode: string | null;
  referenceNumber: string | null;
  paidAt: Date | null;
  remarks: string | null;
  updatedAt: Date;
  requestedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

type PaymentsTableProps = {
  invoiceId: string;
  redirectTo: string;
  payments: PaymentRow[];
  canUpdate: boolean;
  canDelete: boolean;
  canStatusUpdate: boolean;
};

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

function userLabel(user: { name: string | null; email: string | null; phone: string | null } | null) {
  if (!user) {
    return "-";
  }
  return user.name?.trim() || user.email || user.phone || "-";
}

export function PaymentsTable({ invoiceId, redirectTo, payments, canUpdate, canDelete, canStatusUpdate }: PaymentsTableProps) {
  if (payments.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No payments made recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Payment Made</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Mode</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Requested By</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <p className="font-medium">{payment.paymentNumber}</p>
                  <p className="text-xs text-[var(--muted)]">Updated {formatDateTime(payment.updatedAt)}</p>
                </td>
                <td className="px-3 py-2">{formatDateTime(payment.paidAt)}</td>
                <td className="px-3 py-2">{toMoney(payment.amount)}</td>
                <td className="px-3 py-2">{payment.mode ?? "-"}</td>
                <td className="px-3 py-2">{payment.referenceNumber?.trim() || "-"}</td>
                <td className="px-3 py-2">
                  <StatusBadge value={payment.status} />
                </td>
                <td className="px-3 py-2">{userLabel(payment.requestedBy)}</td>
                <td className="px-3 py-2">
                  <div className="space-y-2">
                    {canStatusUpdate ? (
                      <PaymentStatusActions paymentId={payment.id} currentStatus={payment.status} redirectTo={redirectTo} />
                    ) : null}
                    {canDelete ? (
                      <form action={deletePaymentAction.bind(null, payment.id)}>
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <button type="submit" className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">
                          Void
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canUpdate ? (
        <div className="space-y-2">
          {payments.map((payment) => (
            <details key={`${payment.id}-edit`} className="rounded-md border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--primary)]">Edit {payment.paymentNumber}</summary>
              <div className="mt-3">
                <PaymentForm
                  action={updatePaymentAction.bind(null, payment.id)}
                  invoiceId={invoiceId}
                  redirectTo={redirectTo}
                  submitLabel="Update Payment Made"
                  compact
                  payment={{
                    amount: Number(payment.amount).toFixed(2),
                    paymentDate: payment.paidAt,
                    mode: payment.mode,
                    referenceNumber: payment.referenceNumber,
                    notes: payment.remarks,
                    status: payment.status,
                  }}
                />
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
