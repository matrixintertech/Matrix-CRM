"use client";

import { useMemo, useState } from "react";

import { updateRolePermissionsAction } from "@/features/rbac/actions/role.actions";

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

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, PermissionOption[]>();
    for (const permission of filteredPermissions) {
      const entries = map.get(permission.module) ?? [];
      entries.push(permission);
      map.set(permission.module, entries);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
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

  function applyPreset(preset: "full" | "read_only" | "operations") {
    if (preset === "full") {
      setSelectedPermissionIds(new Set(permissions.map((permission) => permission.id)));
      return;
    }

    if (preset === "read_only") {
      setSelectedPermissionIds(
        new Set(
          permissions
            .filter((permission) => permission.action === "read" || permission.key.endsWith(".read"))
            .map((permission) => permission.id)
        )
      );
      return;
    }

    setSelectedPermissionIds(
      new Set(
        permissions
          .filter((permission) => {
            const action = permission.action.toLowerCase();
            return action === "read" || action === "create" || action === "update" || action === "delete";
          })
          .map((permission) => permission.id)
      )
    );
  }

  return (
    <form action={updateRolePermissionsAction.bind(null, roleId)} className="space-y-4 rounded-md border border-[var(--border)] bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Role Permissions</h2>
        <p className="text-sm text-[var(--muted)]">Users assigned to this role receive these permissions. Changes apply to all users on this role.</p>
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => applyPreset("full")}
          disabled={isProtectedRole}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
        >
          Full Access
        </button>
        <button
          type="button"
          onClick={() => applyPreset("read_only")}
          disabled={isProtectedRole}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
        >
          Read Only
        </button>
        <button
          type="button"
          onClick={() => applyPreset("operations")}
          disabled={isProtectedRole}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
        >
          Operations
        </button>
      </div>

      {groupedPermissions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No permissions match this search.</p>
      ) : (
        <div className="space-y-3">
          {groupedPermissions.map(([module, modulePermissions]) => {
            const selectedInModule = modulePermissions.filter((permission) => selectedPermissionIds.has(permission.id)).length;
            return (
              <details key={module} className="rounded-md border border-[var(--border)]" open>
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2">
                  <span className="font-medium">{module.replaceAll("_", " ").toUpperCase()}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {selectedInModule}/{modulePermissions.length}
                  </span>
                </summary>
                <div className="border-t border-[var(--border)] px-3 py-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => selectAllForModule(modulePermissions)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                      disabled={isProtectedRole}
                    >
                      Select all
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
                  <div className="grid gap-2 md:grid-cols-2">
                    {modulePermissions.map((permission) => (
                      <label key={permission.id} className="flex items-center gap-2 rounded-md border border-slate-100 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedPermissionIds.has(permission.id)}
                          onChange={() => togglePermission(permission.id)}
                          disabled={isProtectedRole}
                        />
                        <span className="text-sm">{permission.key}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </details>
            );
          })}
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
