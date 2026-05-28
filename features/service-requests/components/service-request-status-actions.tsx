import { ServiceRequestStatus } from "@prisma/client";

import { deleteServiceRequestAction, updateServiceRequestStatusAction } from "@/features/service-requests/actions/service-request.actions";

const statusOptions: ServiceRequestStatus[] = [
  ServiceRequestStatus.DRAFT,
  ServiceRequestStatus.RAISED,
  ServiceRequestStatus.TRIAGED,
  ServiceRequestStatus.PM_ASSIGNED,
  ServiceRequestStatus.SM_ASSIGNED,
  ServiceRequestStatus.QUOTE_PREPARING,
  ServiceRequestStatus.QUOTE_SUBMITTED,
  ServiceRequestStatus.QUOTE_APPROVED,
  ServiceRequestStatus.QUOTE_REJECTED,
  ServiceRequestStatus.IN_PROGRESS,
  ServiceRequestStatus.BLOCKED,
  ServiceRequestStatus.COMPLETED,
  ServiceRequestStatus.CLOSED,
  ServiceRequestStatus.CANCELLED,
];

type ServiceRequestStatusActionsProps = {
  serviceRequestId: string;
  currentStatus: ServiceRequestStatus;
  canDelete: boolean;
};

export function ServiceRequestStatusActions({
  serviceRequestId,
  currentStatus,
  canDelete,
}: ServiceRequestStatusActionsProps) {
  return (
    <div className="space-y-3">
      <form action={updateServiceRequestStatusAction.bind(null, serviceRequestId)} className="space-y-2">
        <input type="hidden" name="redirectTo" value={`/service-requests/${serviceRequestId}`} />
        <label className="space-y-1 text-sm">
          <span className="font-medium">Update status</span>
          <select
            name="status"
            defaultValue={currentStatus}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Remarks (optional)</span>
          <textarea
            name="remarks"
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={500}
          />
        </label>
        <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
          Save status
        </button>
      </form>

      {canDelete ? (
        <form action={deleteServiceRequestAction.bind(null, serviceRequestId)}>
          <input type="hidden" name="redirectTo" value="/service-requests" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete request
          </button>
        </form>
      ) : null}
    </div>
  );
}
