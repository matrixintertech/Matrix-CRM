import { assignUserRoleAction, removeUserRoleAction } from "@/features/users/actions/user.actions";

type RoleOption = {
  id: string;
  name: string;
  key: string;
  isSystem: boolean;
  servicePartner: { name: string; code: string };
};

type AssignedRole = {
  role: {
    id: string;
    name: string;
    key: string;
    isSystem: boolean;
  };
};

export function UserRoleForm({
  userId,
  roles,
  assignedRoles,
}: {
  userId: string;
  roles: RoleOption[];
  assignedRoles: AssignedRole[];
}) {
  const assignedIds = new Set(assignedRoles.map((entry) => entry.role.id));
  const availableRoles = roles.filter((role) => !assignedIds.has(role.id));

  return (
    <div className="space-y-4 rounded-md border border-[var(--border)] bg-white p-5">
      <div>
        <h2 className="font-semibold">Roles</h2>
        <p className="text-sm text-[var(--muted)]">Assign or remove access roles for this user.</p>
      </div>
      <div className="space-y-2">
        {assignedRoles.length === 0 ? <p className="text-sm text-[var(--muted)]">No roles assigned.</p> : null}
        {assignedRoles.map((entry) => (
          <div key={entry.role.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-medium">{entry.role.name}</p>
              <p className="text-xs text-[var(--muted)]">{entry.role.key}</p>
            </div>
            <form action={removeUserRoleAction.bind(null, userId)}>
              <input type="hidden" name="roleId" value={entry.role.id} />
              <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>
      <form action={assignUserRoleAction.bind(null, userId)} className="flex gap-2">
        <select name="roleId" className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] px-3 text-sm">
          {availableRoles.length === 0 ? <option value="">No roles available</option> : null}
          {availableRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name} ({role.servicePartner.code})
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={availableRoles.length === 0}
          className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Assign role
        </button>
      </form>
    </div>
  );
}
