import { ApprovalStatus } from "@prisma/client";

import { updateQuotationStatusAction } from "@/features/quotations/actions/quotation.actions";

const statusOptions: ApprovalStatus[] = [
  ApprovalStatus.PENDING,
  ApprovalStatus.REVISED,
  ApprovalStatus.REJECTED,
  ApprovalStatus.APPROVED,
];

type QuotationStatusActionsProps = {
  quotationId: string;
  currentStatus: ApprovalStatus;
  redirectTo: string;
};

export function QuotationStatusActions({ quotationId, currentStatus, redirectTo }: QuotationStatusActionsProps) {
  return (
    <form action={updateQuotationStatusAction.bind(null, quotationId)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select
        name="status"
        defaultValue={currentStatus}
        className="h-10 rounded-xl border border-[var(--border)] px-3 text-sm"
      >
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
