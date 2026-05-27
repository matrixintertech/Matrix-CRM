import { RateCardStatus } from "@prisma/client";

import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type RateCardRow = {
  id: string;
  code: string;
  name: string;
  status: RateCardStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  client: {
    id: string;
    code: string;
    name: string;
  } | null;
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
  _count: {
    lines: number;
  };
};

export function RateCardsTable({ rateCards }: { rateCards: RateCardRow[] }) {
  return (
    <DataTable
      rows={rateCards}
      getRowKey={(rateCard) => rateCard.id}
      getRowHref={(rateCard) => `/rate-cards/${rateCard.id}`}
      columns={[
        {
          header: "Rate Card",
          cell: (rateCard) => (
            <div>
              <p className="font-medium text-slate-900">{rateCard.name}</p>
              <p className="text-xs text-[var(--muted)]">{rateCard.code}</p>
            </div>
          ),
        },
        {
          header: "Client",
          cell: (rateCard) => (rateCard.client ? `${rateCard.client.name} (${rateCard.client.code})` : "General"),
        },
        { header: "Status", cell: (rateCard) => <StatusBadge value={rateCard.status} /> },
        { header: "Lines", cell: (rateCard) => rateCard._count.lines },
        {
          header: "Effective",
          cell: (rateCard) => `${formatDateTime(rateCard.effectiveFrom)} to ${rateCard.effectiveTo ? formatDateTime(rateCard.effectiveTo) : "-"}`,
        },
        { header: "Tenant", cell: (rateCard) => `${rateCard.servicePartner.name} (${rateCard.servicePartner.code})` },
        { header: "Created", cell: (rateCard) => formatDateTime(rateCard.createdAt) },
      ]}
    />
  );
}
