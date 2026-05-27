import { assignRolePermissionAction, removeRolePermissionAction } from "@/features/rbac/actions/role.actions";

type PermissionOption = {
  id: string;
  key: string;
  module: string;
  action: string;
};

type AssignedPermission = {
  permission: PermissionOption;
};

type RolePermissionFormProps = {
  roleId: string;
  isProtectedRole: boolean;
  permissions: PermissionOption[];
  assignedPermissions: AssignedPermission[];
};

export function RolePermissionForm({ roleId, isProtectedRole, permissions, assignedPermissions }: RolePermissionFormProps) {
  const assignedIds = new Set(assignedPermissions.map((entry) => entry.permission.id));
  const availablePermissions = permissions.filter((permission) => !assignedIds.has(permission.id));

  return (
    <div className="space-y-4 rounded-md border border-[var(--border)] bg-white p-5">
      <div>
        <h2 className="font-semibold">Permissions</h2>
        <p className="text-sm text-[var(--muted)]">Assign and remove permissions for this role.</p>
      </div>

      <div className="space-y-2">
        {assignedPermissions.length === 0 ? <p className="text-sm text-[var(--muted)]">No permissions assigned.</p> : null}
        {assignedPermissions.map((entry) => (
          <div key={entry.permission.id} className="flex items-center justify-between rounded-md border border-slate-200 p-3">
            <div>
              <p className="text-sm font-medium">{entry.permission.key}</p>
              <p className="text-xs text-[var(--muted)]">
                {entry.permission.module}.{entry.permission.action}
              </p>
            </div>
            <form action={removeRolePermissionAction.bind(null, roleId)}>
              <input type="hidden" name="permissionId" value={entry.permission.id} />
              <button
                type="submit"
                disabled={isProtectedRole}
                className="rounded-md border border-red-200 px-3 py-2 text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Remove
              </button>
            </form>
          </div>
        ))}
      </div>

      <form action={assignRolePermissionAction.bind(null, roleId)} className="flex gap-2">
        <select
          name="permissionId"
          className="h-9 min-w-0 flex-1 rounded-md border border-[var(--border)] px-3 text-sm"
          disabled={availablePermissions.length === 0 || isProtectedRole}
        >
          {availablePermissions.length === 0 ? <option value="">No permissions available</option> : null}
          {availablePermissions.map((permission) => (
            <option key={permission.id} value={permission.id}>
              {permission.key}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={availablePermissions.length === 0 || isProtectedRole}
          className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Assign permission
        </button>
      </form>
      {isProtectedRole ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This role is protected. Permission changes are restricted.
        </p>
      ) : null}
    </div>
  );
}
