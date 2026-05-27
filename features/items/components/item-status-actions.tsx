import { deleteItemAction, updateItemActiveAction } from "@/features/items/actions/item.actions";

export function ItemStatusActions({ itemId, canDelete }: { itemId: string; canDelete: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <form action={updateItemActiveAction.bind(null, itemId)}>
        <input type="hidden" name="active" value="true" />
        <input type="hidden" name="redirectTo" value={`/items/${itemId}`} />
        <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          Set active
        </button>
      </form>
      <form action={updateItemActiveAction.bind(null, itemId)}>
        <input type="hidden" name="active" value="false" />
        <input type="hidden" name="redirectTo" value={`/items/${itemId}`} />
        <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
          Set inactive
        </button>
      </form>
      {canDelete ? (
        <form action={deleteItemAction.bind(null, itemId)}>
          <input type="hidden" name="redirectTo" value="/items" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}

