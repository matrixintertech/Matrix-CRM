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
    <form action={updateQuotationStatusAction.bind(null, quotationId)} className="flex items-center gap-2">
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
