import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: Date;
  servicePartner: { name: string; code: string };
  roles: { role: { name: string; key: string } }[];
};

export function UsersTable({ users }: { users: UserRow[] }) {
  return (
    <DataTable
      rows={users}
      getRowKey={(user) => user.id}
      getRowHref={(user) => `/users/${user.id}`}
      columns={[
        {
          header: "User",
          cell: (user) => (
            <div>
              <p className="font-medium text-slate-900">{formatOptional(user.name)}</p>
              <p className="text-xs text-[var(--muted)]">{formatOptional(user.email)}</p>
            </div>
          ),
        },
        { header: "Phone", cell: (user) => formatOptional(user.phone) },
        { header: "Status", cell: (user) => <StatusBadge value={user.status} /> },
        { header: "Roles", cell: (user) => user.roles.map((entry) => entry.role.name).join(", ") || "-" },
        { header: "Tenant", cell: (user) => `${user.servicePartner.name} (${user.servicePartner.code})` },
        { header: "Created", cell: (user) => formatDateTime(user.createdAt) },
      ]}
    />
  );
}
