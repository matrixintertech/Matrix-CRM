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
    <div className="crm-panel space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[#122449]">Assigned Roles</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Users receive access from assigned roles. Update role permissions from the Roles module.</p>
      </div>
      <div className="space-y-2">
        {assignedRoles.length === 0 ? <p className="text-sm text-[var(--muted)]">No roles assigned.</p> : null}
        {assignedRoles.map((entry) => (
          <div key={entry.role.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[#e8eef8] bg-[#fbfcff] p-3">
            <div>
              <p className="text-sm font-medium text-[#122449]">{entry.role.name}</p>
              <p className="text-xs text-[var(--muted)]">{entry.role.key}</p>
            </div>
            <form action={removeUserRoleAction.bind(null, userId)}>
              <input type="hidden" name="roleId" value={entry.role.id} />
              <button type="submit" className="crm-button-danger">
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>
      <form action={assignUserRoleAction.bind(null, userId)} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select name="roleId" className="crm-select min-w-0">
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
          className="crm-button disabled:opacity-50"
        >
          Assign role
        </button>
      </form>
    </div>
  );
}
