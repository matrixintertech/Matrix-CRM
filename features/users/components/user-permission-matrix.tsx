"use client";

import { useMemo, useState } from "react";

type RoleOption = {
  id: string;
  name: string;
  key: string;
  scope: string;
};

type PermissionOption = {
  id: string;
  key: string;
  module: string;
  action: string;
  description: string | null;
};

type UserPermissionMatrixProps = {
  roles: RoleOption[];
  permissions: PermissionOption[];
  roleTemplatePermissionIds: Record<string, string[]>;
  defaultRoleId?: string;
  initialPermissionIds: string[];
};

function normalizeModuleLabel(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

export function UserPermissionMatrix({
  roles,
  permissions,
  roleTemplatePermissionIds,
  defaultRoleId,
  initialPermissionIds,
}: UserPermissionMatrixProps) {
  const [selectedRoleId, setSelectedRoleId] = useState(defaultRoleId ?? "");
  const [query, setQuery] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(() => new Set(initialPermissionIds));

  const filteredPermissions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return permissions;
    }

    return permissions.filter((permission) =>
      [permission.key, permission.module, permission.action, permission.description ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [permissions, query]);

  const groupedPermissions = useMemo(() => {
    const groups = new Map<string, PermissionOption[]>();
    for (const permission of filteredPermissions) {
      const modulePermissions = groups.get(permission.module) ?? [];
      modulePermissions.push(permission);
      groups.set(permission.module, modulePermissions);
    }
    return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [filteredPermissions]);

  const selectedModuleCount = useMemo(() => {
    const moduleSet = new Set<string>();
    for (const permission of permissions) {
      if (selectedPermissionIds.has(permission.id)) {
        moduleSet.add(permission.module);
      }
    }
    return moduleSet.size;
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

  function selectAllInModule(modulePermissions: PermissionOption[]) {
    setSelectedPermissionIds((current) => {
      const next = new Set(current);
      for (const permission of modulePermissions) {
        next.add(permission.id);
      }
      return next;
    });
  }

  function clearModule(modulePermissions: PermissionOption[]) {
    setSelectedPermissionIds((current) => {
      const next = new Set(current);
      for (const permission of modulePermissions) {
        next.delete(permission.id);
      }
      return next;
    });
  }

  function applyRoleTemplate() {
    if (!selectedRoleId) {
      return;
    }
    setSelectedPermissionIds(new Set(roleTemplatePermissionIds[selectedRoleId] ?? []));
  }

  function applyReadOnlyPreset() {
    setSelectedPermissionIds(
      new Set(
        permissions
          .filter((permission) => permission.action.toLowerCase() === "read" || permission.key.endsWith(".read"))
          .map((permission) => permission.id)
      )
    );
  }

  function applyFullPreset() {
    setSelectedPermissionIds(new Set(permissions.map((permission) => permission.id)));
  }

  function clearAllPermissions() {
    setSelectedPermissionIds(new Set());
  }

  return (
    <div className="space-y-4">
      {roles.length > 0 ? (
        <label className="space-y-1 text-sm">
          <span className="font-medium">Role / Designation</span>
          <select
            name="roleId"
            value={selectedRoleId}
            onChange={(event) => setSelectedRoleId(event.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.key}, {role.scope})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <input type="hidden" name="roleId" value="" />
          <p className="text-sm text-[var(--muted)]">No assignable role available for your scope.</p>
        </>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        Selected: <span className="font-semibold">{selectedPermissionIds.size}</span> permissions across{" "}
        <span className="font-semibold">{selectedModuleCount}</span> modules.
      </div>
      {selectedPermissionIds.size === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This user will not be able to access any modules unless permissions are selected.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Search permissions</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by permission, module, or action"
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <button
            type="button"
            onClick={applyRoleTemplate}
            disabled={!selectedRoleId}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            Use Role Template
          </button>
          <button type="button" onClick={applyReadOnlyPreset} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
            Read Only
          </button>
          <button type="button" onClick={applyFullPreset} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
            Full Allowed Access
          </button>
          <button type="button" onClick={clearAllPermissions} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
            Clear All
          </button>
        </div>
      </div>

      {groupedPermissions.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No permissions available for assignment.</p>
      ) : (
        <div className="space-y-3">
          {groupedPermissions.map(([module, modulePermissions]) => {
            const selectedInModule = modulePermissions.filter((permission) => selectedPermissionIds.has(permission.id)).length;
            return (
              <details key={module} className="rounded-md border border-[var(--border)]" open>
                <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2">
                  <span className="font-medium">{normalizeModuleLabel(module)}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {selectedInModule}/{modulePermissions.length}
                  </span>
                </summary>
                <div className="border-t border-[var(--border)] px-3 py-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => selectAllInModule(modulePermissions)} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
                      Select all in module
                    </button>
                    <button type="button" onClick={() => clearModule(modulePermissions)} className="rounded-md border border-slate-200 px-2 py-1 text-xs">
                      Clear module
                    </button>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {modulePermissions.map((permission) => (
                      <label key={permission.id} className="flex items-start gap-2 rounded-md border border-slate-100 px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={selectedPermissionIds.has(permission.id)}
                          onChange={() => togglePermission(permission.id)}
                          className="mt-1"
                        />
                        <span className="text-sm">
                          <span className="font-medium">{permission.key}</span>
                          {permission.description ? <span className="mt-0.5 block text-xs text-[var(--muted)]">{permission.description}</span> : null}
                        </span>
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
    </div>
  );
}
