import { DataTable } from "@/components/admin/data-table";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type BranchRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  createdAt: Date;
  client: {
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

export function BranchesTable({ branches }: { branches: BranchRow[] }) {
  return (
    <DataTable
      rows={branches}
      getRowKey={(branch) => branch.id}
      getRowHref={(branch) => `/branches/${branch.id}`}
      columns={[
        {
          header: "Branch",
          cell: (branch) => (
            <div>
              <p className="font-medium text-slate-900">{branch.name}</p>
              <p className="text-xs text-[var(--muted)]">{branch.code}</p>
            </div>
          ),
        },
        {
          header: "Client",
          cell: (branch) => `${branch.client.name} (${branch.client.code})`,
        },
        {
          header: "Location",
          cell: (branch) => {
            const city = formatOptional(branch.city);
            const state = formatOptional(branch.state);
            if (city === "-" && state === "-") {
              return "-";
            }
            if (city === "-") {
              return state;
            }
            if (state === "-") {
              return city;
            }
            return `${city}, ${state}`;
          },
        },
        {
          header: "Tenant",
          cell: (branch) => `${branch.servicePartner.name} (${branch.servicePartner.code})`,
        },
        { header: "Created", cell: (branch) => formatDateTime(branch.createdAt) },
      ]}
    />
  );
}
