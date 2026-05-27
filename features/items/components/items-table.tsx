import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type ItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  active: boolean;
  createdAt: Date;
  category: {
    id: string;
    code: string;
    name: string;
  };
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
};

export function ItemsTable({ items }: { items: ItemRow[] }) {
  return (
    <DataTable
      rows={items}
      getRowKey={(item) => item.id}
      getRowHref={(item) => `/items/${item.id}`}
      columns={[
        {
          header: "Item",
          cell: (item) => (
            <div>
              <p className="font-medium text-slate-900">{item.name}</p>
              <p className="text-xs text-[var(--muted)]">
                {item.code} - {item.unit}
              </p>
            </div>
          ),
        },
        {
          header: "Category",
          cell: (item) => (
            <div>
              <p>{item.category.name}</p>
              <p className="text-xs text-[var(--muted)]">{item.category.code}</p>
            </div>
          ),
        },
        { header: "Status", cell: (item) => <StatusBadge value={item.active ? "ACTIVE" : "INACTIVE"} /> },
        { header: "Tenant", cell: (item) => `${item.servicePartner.name} (${item.servicePartner.code})` },
        { header: "Created", cell: (item) => formatDateTime(item.createdAt) },
      ]}
    />
  );
}
