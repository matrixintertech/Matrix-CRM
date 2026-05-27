import { DataTable } from "@/components/admin/data-table";
import { formatDateTime } from "@/lib/utils/format";

type CategoryRow = {
  id: string;
  code: string;
  name: string;
  createdAt: Date;
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
  _count: {
    items: number;
  };
};

export function CategoriesTable({ categories }: { categories: CategoryRow[] }) {
  return (
    <DataTable
      rows={categories}
      getRowKey={(category) => category.id}
      getRowHref={(category) => `/categories/${category.id}`}
      columns={[
        {
          header: "Category",
          cell: (category) => (
            <div>
              <p className="font-medium text-slate-900">{category.name}</p>
              <p className="text-xs text-[var(--muted)]">{category.code}</p>
            </div>
          ),
        },
        {
          header: "Tenant",
          cell: (category) => `${category.servicePartner.name} (${category.servicePartner.code})`,
        },
        {
          header: "Items",
          cell: (category) => category._count.items,
        },
        { header: "Created", cell: (category) => formatDateTime(category.createdAt) },
      ]}
    />
  );
}
