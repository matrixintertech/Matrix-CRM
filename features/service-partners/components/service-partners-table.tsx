import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ServicePartnerRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: Date;
  _count: {
    users: number;
    clients: number;
    branches: number;
  };
};

export function ServicePartnersTable({ servicePartners }: { servicePartners: ServicePartnerRow[] }) {
  return (
    <DataTable
      rows={servicePartners}
      getRowKey={(servicePartner) => servicePartner.id}
      getRowHref={(servicePartner) => `/service-partners/${servicePartner.id}`}
      columns={[
        {
          header: "Service Partner",
          cell: (servicePartner) => (
            <div>
              <p className="font-medium text-slate-900">{servicePartner.name}</p>
              <p className="text-xs text-[var(--muted)]">{servicePartner.code}</p>
            </div>
          ),
        },
        { header: "Email", cell: (servicePartner) => formatOptional(servicePartner.email) },
        { header: "Phone", cell: (servicePartner) => formatOptional(servicePartner.phone) },
        { header: "Status", cell: (servicePartner) => <StatusBadge value={servicePartner.status} /> },
        { header: "Users", cell: (servicePartner) => servicePartner._count.users },
        { header: "Clients", cell: (servicePartner) => servicePartner._count.clients },
        { header: "Branches", cell: (servicePartner) => servicePartner._count.branches },
        { header: "Created", cell: (servicePartner) => formatDateTime(servicePartner.createdAt) },
      ]}
    />
  );
}
