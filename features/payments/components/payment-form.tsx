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
    <form action={action} className={compact ? "space-y-2" : "crm-form-shell space-y-3"}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="crm-form-grid md:grid-cols-2">
        <label className="crm-field">
          <span className="crm-field-label">Amount Paid</span>
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={payment?.amount ?? ""}
            className="crm-input"
            required
          />
        </label>
        <label className="crm-field">
          <span className="crm-field-label">Paid Date</span>
          <input
            name="paymentDate"
            type="date"
            defaultValue={toDateInput(payment?.paymentDate)}
            className="crm-input"
            required
          />
        </label>
      </div>

      <div className="crm-form-grid md:grid-cols-2">
        <label className="crm-field">
          <span className="crm-field-label">Mode</span>
          <select name="mode" defaultValue={payment?.mode ?? "BANK_TRANSFER"} className="crm-select">
            {paymentModeValues.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <label className="crm-field">
          <span className="crm-field-label">Status</span>
          <select name="status" defaultValue={payment?.status ?? PaymentStatus.PAID} className="crm-select">
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="crm-field">
        <span className="crm-field-label">Reference Number</span>
        <input
          name="referenceNumber"
          defaultValue={payment?.referenceNumber ?? ""}
          maxLength={120}
          className="crm-input"
        />
      </label>

      <label className="crm-field">
        <span className="crm-field-label">Notes</span>
        <textarea
          name="notes"
          defaultValue={payment?.notes ?? ""}
          maxLength={1200}
          className="crm-textarea"
        />
      </label>

      <button type="submit" className="crm-button w-full sm:w-auto">
        {submitLabel}
      </button>
    </form>
  );
}
