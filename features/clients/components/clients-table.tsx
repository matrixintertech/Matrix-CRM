import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ClientRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: Date;
  servicePartner: {
    id: string;
    name: string;
    code: string;
  };
  _count: {
    branches: number;
  };
};

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  return (
    <DataTable
      rows={clients}
      getRowKey={(client) => client.id}
      getRowHref={(client) => `/clients/${client.id}`}
      columns={[
        {
          header: "Client",
          cell: (client) => (
            <div>
              <p className="font-medium text-slate-900">{client.name}</p>
              <p className="text-xs text-[var(--muted)]">{client.code}</p>
            </div>
          ),
        },
        { header: "Email", cell: (client) => formatOptional(client.email) },
        { header: "Phone", cell: (client) => formatOptional(client.phone) },
        { header: "Status", cell: (client) => <StatusBadge value={client.status} /> },
        { header: "Branches", cell: (client) => client._count.branches },
        {
          header: "Tenant",
          cell: (client) => `${client.servicePartner.name} (${client.servicePartner.code})`,
        },
        { header: "Created", cell: (client) => formatDateTime(client.createdAt) },
      ]}
    />
  );
}
