import { ClientStatus } from "@prisma/client";

import { deleteClientAction, updateClientStatusAction } from "@/features/clients/actions/client.actions";

export function ClientStatusActions({ clientId, canDelete }: { clientId: string; canDelete: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.values(ClientStatus).map((status) => (
        <form key={status} action={updateClientStatusAction.bind(null, clientId)}>
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="redirectTo" value={`/clients/${clientId}`} />
          <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
            Set {status.toLowerCase().replace("_", " ")}
          </button>
        </form>
      ))}
      {canDelete ? (
        <form action={deleteClientAction.bind(null, clientId)}>
          <input type="hidden" name="redirectTo" value="/clients" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
