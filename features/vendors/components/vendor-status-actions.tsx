import { VendorStatus } from "@prisma/client";

import { deleteVendorAction, updateVendorStatusAction } from "@/features/vendors/actions/vendor.actions";

type VendorStatusActionsProps = {
  vendorId: string;
  currentStatus: VendorStatus;
  isVerified: boolean;
  canDelete: boolean;
};

const statusOptions: VendorStatus[] = [
  VendorStatus.PENDING_VERIFICATION,
  VendorStatus.ACTIVE,
  VendorStatus.REJECTED,
  VendorStatus.INACTIVE,
];

export function VendorStatusActions({ vendorId, currentStatus, isVerified, canDelete }: VendorStatusActionsProps) {
  return (
    <div className="space-y-2">
      <form action={updateVendorStatusAction.bind(null, vendorId)} className="space-y-2">
        <input type="hidden" name="redirectTo" value={`/vendors/${vendorId}`} />
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
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Verification</span>
          <select name="isVerified" defaultValue={String(isVerified)} className="h-9 w-full rounded-md border border-[var(--border)] px-3">
            <option value="true">Verified</option>
            <option value="false">Not verified</option>
          </select>
        </label>
        <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          Save status
        </button>
      </form>

      {canDelete ? (
        <form action={deleteVendorAction.bind(null, vendorId)}>
          <input type="hidden" name="redirectTo" value="/vendors" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
