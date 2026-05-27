import { RateCardStatus } from "@prisma/client";

import { deleteRateCardAction, updateRateCardStatusAction } from "@/features/rate-cards/actions/rate-card.actions";

type RateCardStatusActionsProps = {
  rateCardId: string;
  canDelete: boolean;
  canPublish: boolean;
};

export function RateCardStatusActions({ rateCardId, canDelete, canPublish }: RateCardStatusActionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.values(RateCardStatus).map((status) => {
        if (status === RateCardStatus.ACTIVE && !canPublish) {
          return null;
        }

        return (
          <form key={status} action={updateRateCardStatusAction.bind(null, rateCardId)}>
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="redirectTo" value={`/rate-cards/${rateCardId}`} />
            <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              Set {status.toLowerCase().replace("_", " ")}
            </button>
          </form>
        );
      })}
      {canDelete ? (
        <form action={deleteRateCardAction.bind(null, rateCardId)}>
          <input type="hidden" name="redirectTo" value="/rate-cards" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}

