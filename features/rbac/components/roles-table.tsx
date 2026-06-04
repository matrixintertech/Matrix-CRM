import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type RoleRow = {
  id: string;
  name: string;
  key: string;
  scope: "TENANT" | "PLATFORM";
  level: number;
  isSystem: boolean;
  createdAt: Date;
  servicePartner: { name: string; code: string };
  _count: {
    users: number;
    permissions: number;
  };
};

export function RolesTable({ roles }: { roles: RoleRow[] }) {
  return (
    <DataTable
      rows={roles}
      getRowKey={(role) => role.id}
      getRowHref={(role) => `/roles/${role.id}`}
      columns={[
        {
          header: "Role",
          cell: (role) => (
            <div>
              <p className="font-medium text-slate-900">{role.name}</p>
              <p className="text-xs text-[var(--muted)]">{role.key}</p>
            </div>
          ),
        },
        { header: "Scope", cell: (role) => <StatusBadge value={role.scope} /> },
        { header: "Level", cell: (role) => role.level },
        {
          header: "Type",
          cell: (role) =>
            role.isSystem ? (
              <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                System
              </span>
            ) : (
              "Custom"
            ),
        },
        { header: "Users", cell: (role) => role._count.users },
        { header: "Permissions", cell: (role) => role._count.permissions },
        { header: "Tenant", cell: (role) => `${role.servicePartner.name} (${role.servicePartner.code})` },
        { header: "Created", cell: (role) => formatDateTime(role.createdAt) },
      ]}
    />
  );
}
