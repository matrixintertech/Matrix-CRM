import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type ServiceRequestRow = {
  id: string;
  serviceNumber: string;
  title: string;
  serviceType: string;
  status: string;
  requestedAt: Date | null;
  targetDate: Date | null;
  createdAt: Date;
  client: {
    id: string;
    code: string;
    name: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
  } | null;
  _count: {
    statusHistory: number;
  };
};

export function ServiceRequestsTable({ serviceRequests }: { serviceRequests: ServiceRequestRow[] }) {
  return (
    <DataTable
      rows={serviceRequests}
      getRowKey={(serviceRequest) => serviceRequest.id}
      getRowHref={(serviceRequest) => `/service-requests/${serviceRequest.id}`}
      columns={[
        {
          header: "Service Request",
          cell: (serviceRequest) => (
            <div>
              <p className="font-medium text-slate-900">{serviceRequest.title}</p>
              <p className="text-xs text-[var(--muted)]">{serviceRequest.serviceNumber}</p>
            </div>
          ),
        },
        {
          header: "Client / Branch",
          cell: (serviceRequest) =>
            `${serviceRequest.client.name} (${serviceRequest.client.code})${
              serviceRequest.branch ? ` - ${serviceRequest.branch.name} (${serviceRequest.branch.code})` : ""
            }`,
        },
        {
          header: "Type",
          cell: (serviceRequest) => serviceRequest.serviceType,
        },
        {
          header: "Status",
          cell: (serviceRequest) => <StatusBadge value={serviceRequest.status} />,
        },
        {
          header: "Timeline",
          cell: (serviceRequest) => serviceRequest._count.statusHistory,
        },
        {
          header: "Requested / Target",
          cell: (serviceRequest) =>
            `${formatDateTime(serviceRequest.requestedAt)} / ${formatDateTime(serviceRequest.targetDate)}`,
        },
        {
          header: "Created",
          cell: (serviceRequest) => formatDateTime(serviceRequest.createdAt),
        },
      ]}
    />
  );
}
