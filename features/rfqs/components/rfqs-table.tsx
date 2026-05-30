import { RfqStatus } from "@prisma/client";

import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type RfqRow = {
  id: string;
  rfqNumber: string;
  title: string;
  status: RfqStatus;
  dueDate: Date | null;
  createdAt: Date;
  serviceRequest: {
    id: string;
    serviceNumber: string;
    title: string;
  } | null;
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
  _count: {
    items: number;
    vendorQuotes: number;
  };
};

export function RfqsTable({ rfqs }: { rfqs: RfqRow[] }) {
  return (
    <DataTable
      rows={rfqs}
      getRowKey={(rfq) => rfq.id}
      getRowHref={(rfq) => `/rfqs/${rfq.id}`}
      columns={[
        {
          header: "RFQ",
          cell: (rfq) => (
            <div>
              <p className="font-medium text-slate-900">{rfq.title}</p>
              <p className="text-xs text-[var(--muted)]">{rfq.rfqNumber}</p>
            </div>
          ),
        },
        { header: "Status", cell: (rfq) => <StatusBadge value={rfq.status} /> },
        {
          header: "Service Request",
          cell: (rfq) => (rfq.serviceRequest ? `${rfq.serviceRequest.serviceNumber}` : "-"),
        },
        {
          header: "Lines / Vendors",
          cell: (rfq) => `${rfq._count.items} / ${rfq._count.vendorQuotes}`,
        },
        {
          header: "Due Date",
          cell: (rfq) => formatDateTime(rfq.dueDate),
        },
        { header: "Tenant", cell: (rfq) => `${rfq.servicePartner.name} (${rfq.servicePartner.code})` },
        { header: "Created", cell: (rfq) => formatDateTime(rfq.createdAt) },
      ]}
    />
  );
}
