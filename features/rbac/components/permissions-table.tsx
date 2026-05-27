import { DataTable } from "@/components/admin/data-table";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type PermissionRow = {
  id: string;
  key: string;
  module: string;
  action: string;
  description: string | null;
  createdAt: Date;
};

export function PermissionsTable({ permissions }: { permissions: PermissionRow[] }) {
  return (
    <DataTable
      rows={permissions}
      getRowKey={(permission) => permission.id}
      columns={[
        { header: "Permission", cell: (permission) => permission.key },
        { header: "Module", cell: (permission) => permission.module },
        { header: "Action", cell: (permission) => permission.action },
        { header: "Description", cell: (permission) => formatOptional(permission.description) },
        { header: "Created", cell: (permission) => formatDateTime(permission.createdAt) },
      ]}
    />
  );
}
