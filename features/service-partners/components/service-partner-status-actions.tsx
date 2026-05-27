import { ServicePartnerStatus } from "@prisma/client";

import { deleteServicePartnerAction, updateServicePartnerStatusAction } from "@/features/service-partners/actions/service-partner.actions";

export function ServicePartnerStatusActions({
  servicePartnerId,
  canDelete,
  canManage,
}: {
  servicePartnerId: string;
  canDelete: boolean;
  canManage: boolean;
}) {
  if (!canManage) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {Object.values(ServicePartnerStatus).map((status) => (
        <form key={status} action={updateServicePartnerStatusAction.bind(null, servicePartnerId)}>
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="redirectTo" value={`/service-partners/${servicePartnerId}`} />
          <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
            Set {status.toLowerCase()}
          </button>
        </form>
      ))}
      {canDelete ? (
        <form action={deleteServicePartnerAction.bind(null, servicePartnerId)}>
          <input type="hidden" name="redirectTo" value="/service-partners" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
