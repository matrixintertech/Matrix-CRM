"use client";

import { useEffect, useMemo, useState } from "react";

type RoleOption = {
  id: string;
  name: string;
  key: string;
  scope: string;
  servicePartnerId: string;
};

type UserRoleSelectorProps = {
  roles: RoleOption[];
  initialRoleIds?: string[];
  selectedServicePartnerId?: string;
};

export function UserRoleSelector({
  roles,
  initialRoleIds = [],
  selectedServicePartnerId,
}: UserRoleSelectorProps) {
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(() => new Set(initialRoleIds));

  const visibleRoles = useMemo(() => {
    if (!selectedServicePartnerId) {
      return roles;
    }

    return roles.filter((role) => role.servicePartnerId === selectedServicePartnerId);
  }, [roles, selectedServicePartnerId]);

  useEffect(() => {
    const visibleRoleIds = new Set(visibleRoles.map((role) => role.id));
    setSelectedRoleIds((current) => new Set(Array.from(current).filter((roleId) => visibleRoleIds.has(roleId))));
  }, [visibleRoles]);

  function toggleRole(roleId: string) {
    setSelectedRoleIds((current) => {
      const next = new Set(current);
      if (next.has(roleId)) {
        next.delete(roleId);
      } else {
        next.add(roleId);
      }
      return next;
    });
  }

  if (visibleRoles.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-[var(--muted)]">No assignable roles are available for this company.</p>
        <input type="hidden" name="roleIds" value="" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        Selected roles: <span className="font-semibold">{selectedRoleIds.size}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {visibleRoles.map((role) => {
          const isSelected = selectedRoleIds.has(role.id);

          return (
            <label
              key={role.id}
              className={`flex items-start gap-3 rounded-xl border px-3 py-3 transition ${
                isSelected ? "border-[var(--primary)] bg-blue-50/60" : "border-slate-200 bg-white"
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => toggleRole(role.id)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{role.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {role.key} · {role.scope}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {selectedRoleIds.size === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          This user will not receive module access until at least one role is assigned.
        </p>
      ) : null}

      {Array.from(selectedRoleIds).map((roleId) => (
        <input key={roleId} type="hidden" name="roleIds" value={roleId} />
      ))}
    </div>
  );
}
