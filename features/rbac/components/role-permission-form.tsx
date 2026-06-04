"use client";

import { useMemo, useState } from "react";

import { updateRolePermissionsAction } from "@/features/rbac/actions/role.actions";
import { comparePermissionActions, getPermissionActionLabel } from "@/lib/rbac/permission-matrix";

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

type MatrixRow = {
  module: string;
  actions: Map<string, PermissionOption>;
};

function formatModuleLabel(module: string) {
  return module.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

export function RolePermissionForm({ roleId, isProtectedRole, permissions, assignedPermissions }: RolePermissionFormProps) {
  const [query, setQuery] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(
    () => new Set(assignedPermissions.map((entry) => entry.permission.id))
  );

  const filteredPermissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return permissions;
    }

    return permissions.filter((permission) =>
      [permission.key, permission.module, permission.action].some((value) => value.toLowerCase().includes(normalizedQuery))
    );
  }, [permissions, query]);

  const matrixRows = useMemo(() => {
    const rowsByModule = new Map<string, MatrixRow>();

    for (const permission of filteredPermissions) {
      const row = rowsByModule.get(permission.module) ?? {
        module: permission.module,
        actions: new Map<string, PermissionOption>(),
      };
      row.actions.set(permission.action, permission);
      rowsByModule.set(permission.module, row);
    }

    return Array.from(rowsByModule.values())
      .sort((left, right) => left.module.localeCompare(right.module));
  }, [filteredPermissions]);

  const visibleActions = useMemo(() => {
    const actionSet = new Set<string>();
    for (const permission of filteredPermissions) {
      actionSet.add(permission.action);
    }
    return Array.from(actionSet).sort(comparePermissionActions);
  }, [filteredPermissions]);

  const selectedModuleCount = useMemo(() => {
    const modules = new Set<string>();
    for (const permission of permissions) {
      if (selectedPermissionIds.has(permission.id)) {
        modules.add(permission.module);
      }
    }
    return modules.size;
  }, [permissions, selectedPermissionIds]);

  function togglePermission(permissionId: string) {
    setSelectedPermissionIds((current) => {
      const next = new Set(current);
      if (next.has(permissionId)) {
        next.delete(permissionId);
      } else {
        next.add(permissionId);
      }
      return next;
    });
  }

  function selectAllForModule(modulePermissions: PermissionOption[]) {
    setSelectedPermissionIds((current) => {
      const next = new Set(current);
      for (const permission of modulePermissions) {
        next.add(permission.id);
      }
      return next;
    });
  }

  function clearForModule(modulePermissions: PermissionOption[]) {
    setSelectedPermissionIds((current) => {
      const next = new Set(current);
      for (const permission of modulePermissions) {
        next.delete(permission.id);
      }
      return next;
    });
  }

  return (
    <form action={updateRolePermissionsAction.bind(null, roleId)} className="space-y-4 rounded-md border border-[var(--border)] bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Role Permissions</h2>
        <p className="text-sm text-[var(--muted)]">Permissions are grouped by module and aligned by action so role access stays consistent across CRM flows.</p>
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        Selected: <span className="font-semibold">{selectedPermissionIds.size}</span> permissions across{" "}
        <span className="font-semibold">{selectedModuleCount}</span> modules.
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Search permissions</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by key, module, or action"
          className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          disabled={isProtectedRole}
        />
      </label>

      {matrixRows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No permissions match this search.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Module</th>
                {visibleActions.map((action) => (
                  <th key={action} className="px-3 py-2 text-center">
                    {getPermissionActionLabel(action)}
                  </th>
                ))}
                <th className="px-3 py-2 text-center">Bulk</th>
              </tr>
            </thead>
            <tbody>
              {matrixRows.map((row) => {
                const modulePermissions = Array.from(row.actions.values());
                return (
                  <tr key={row.module} className="border-t border-[var(--border)]">
                    <td className="px-3 py-3 align-top">
                      <div>
                        <p className="font-medium text-slate-900">{formatModuleLabel(row.module)}</p>
                        <p className="text-xs text-[var(--muted)]">{modulePermissions.length} action permissions</p>
                      </div>
                    </td>
                    {visibleActions.map((action) => {
                      const permission = row.actions.get(action);
                      if (!permission) {
                        return (
                          <td key={action} className="px-3 py-3 text-center text-slate-300">
                            -
                          </td>
                        );
                      }

                      return (
                        <td key={permission.id} className="px-3 py-3 text-center">
                          <label className="inline-flex items-center justify-center">
                            <input
                              type="checkbox"
                              checked={selectedPermissionIds.has(permission.id)}
                              onChange={() => togglePermission(permission.id)}
                              disabled={isProtectedRole}
                              aria-label={permission.key}
                            />
                          </label>
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-col items-center gap-2">
                        <button
                          type="button"
                          onClick={() => selectAllForModule(modulePermissions)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                          disabled={isProtectedRole}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => clearForModule(modulePermissions)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                          disabled={isProtectedRole}
                        >
                          Clear
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {Array.from(selectedPermissionIds).map((permissionId) => (
        <input key={permissionId} type="hidden" name="permissionIds" value={permissionId} />
      ))}

      <button
        type="submit"
        disabled={isProtectedRole}
        className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save permissions
      </button>

      {isProtectedRole ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This role is protected. Permission changes are restricted.
        </p>
      ) : null}
    </form>
  );
}
