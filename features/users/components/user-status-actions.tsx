import { UserStatus } from "@prisma/client";

import { deleteUserAction, updateUserStatusAction } from "@/features/users/actions/user.actions";

export function UserStatusActions({ userId, canDelete }: { userId: string; canDelete: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.values(UserStatus).map((status) => (
        <form key={status} action={updateUserStatusAction.bind(null, userId)}>
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="redirectTo" value={`/users/${userId}`} />
          <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
            Set {status.toLowerCase()}
          </button>
        </form>
      ))}
      {canDelete ? (
        <form action={deleteUserAction.bind(null, userId)}>
          <input type="hidden" name="redirectTo" value="/users" />
          <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
            Delete
          </button>
        </form>
      ) : null}
    </div>
  );
}
