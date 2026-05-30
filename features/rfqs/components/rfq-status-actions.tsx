import { RfqStatus } from "@prisma/client";

import { deleteRfqAction, sendRfqAction, updateRfqStatusAction } from "@/features/rfqs/actions/rfq.actions";

type RfqStatusActionsProps = {
  rfqId: string;
  currentStatus: RfqStatus;
  canDelete: boolean;
  canSend: boolean;
};

const statusOptions: RfqStatus[] = [
  RfqStatus.DRAFT,
  RfqStatus.PUBLISHED,
  RfqStatus.QUOTING,
  RfqStatus.CLOSED,
  RfqStatus.CANCELLED,
];

export function RfqStatusActions({ rfqId, currentStatus, canDelete, canSend }: RfqStatusActionsProps) {
  return (
    <div className="space-y-2">
      <form action={updateRfqStatusAction.bind(null, rfqId)} className="space-y-2">
        <input type="hidden" name="redirectTo" value={`/rfqs/${rfqId}`} />
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

      {canSend ? (
        <form action={sendRfqAction.bind(null, rfqId)}>
          <input type="hidden" name="redirectTo" value={`/rfqs/${rfqId}`} />
          <button type="submit" className="rounded-md border border-indigo-200 px-3 py-2 text-sm text-indigo-700">
            Send RFQ
          </button>
        </form>
      ) : null}

      {canDelete ? (
        <form action={deleteRfqAction.bind(null, rfqId)}>
          <input type="hidden" name="redirectTo" value="/rfqs" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
