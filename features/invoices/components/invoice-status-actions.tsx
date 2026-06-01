import { InvoiceStatus } from "@prisma/client";

import { deleteInvoiceAction, updateInvoiceStatusAction } from "@/features/invoices/actions/invoice.actions";

type InvoiceStatusActionsProps = {
  invoiceId: string;
  currentStatus: InvoiceStatus;
  canDelete: boolean;
};

const statusOptions: InvoiceStatus[] = [
  InvoiceStatus.DRAFT,
  InvoiceStatus.SUBMITTED,
  InvoiceStatus.APPROVAL_PENDING,
  InvoiceStatus.APPROVED,
  InvoiceStatus.REJECTED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
  InvoiceStatus.CANCELLED,
];

export function InvoiceStatusActions({ invoiceId, currentStatus, canDelete }: InvoiceStatusActionsProps) {
  return (
    <div className="space-y-2">
      <form action={updateInvoiceStatusAction.bind(null, invoiceId)} className="space-y-2">
        <input type="hidden" name="redirectTo" value={`/invoices/${invoiceId}`} />
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
        <form action={deleteInvoiceAction.bind(null, invoiceId)}>
          <input type="hidden" name="redirectTo" value="/invoices" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
