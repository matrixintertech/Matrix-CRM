import { PaymentStatus } from "@prisma/client";

import { paymentModeValues } from "@/features/payments/validations";

type PaymentFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  invoiceId: string;
  redirectTo: string;
  submitLabel: string;
  payment?: {
    amount: string;
    paymentDate: Date | null;
    mode: string | null;
    referenceNumber: string | null;
    notes: string | null;
    status: PaymentStatus;
  };
  compact?: boolean;
};

const statusOptions: PaymentStatus[] = [
  PaymentStatus.REQUESTED,
  PaymentStatus.APPROVED,
  PaymentStatus.PARTIALLY_PAID,
  PaymentStatus.PAID,
  PaymentStatus.REJECTED,
  PaymentStatus.CANCELLED,
];

function toDateInput(value: Date | null | undefined) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  return new Date(value).toISOString().slice(0, 10);
}

export function PaymentForm({ action, invoiceId, redirectTo, submitLabel, payment, compact = false }: PaymentFormProps) {
  return (
    <form action={action} className={compact ? "space-y-2" : "space-y-3 rounded-md border border-[var(--border)] p-3"}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Amount</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={payment?.amount ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Payment Date</span>
          <input
            name="paymentDate"
            type="date"
            defaultValue={toDateInput(payment?.paymentDate)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            required
          />
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Mode</span>
          <select
            name="mode"
            defaultValue={payment?.mode ?? "BANK_TRANSFER"}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {paymentModeValues.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={payment?.status ?? PaymentStatus.PAID}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1 text-sm">
        <span className="font-medium">Reference Number</span>
        <input
          name="referenceNumber"
          defaultValue={payment?.referenceNumber ?? ""}
          maxLength={120}
          className="h-9 w-full rounded-md border border-[var(--border)] px-3"
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium">Notes</span>
        <textarea
          name="notes"
          defaultValue={payment?.notes ?? ""}
          maxLength={1200}
          className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
        />
      </label>

      <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
        {submitLabel}
      </button>
    </form>
  );
}
