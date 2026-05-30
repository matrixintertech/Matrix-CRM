import { VendorStatus } from "@prisma/client";

import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type VendorRow = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: VendorStatus;
  isVerified: boolean;
  gstNumber: string | null;
  createdAt: Date;
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
};

export function VendorsTable({ vendors }: { vendors: VendorRow[] }) {
  return (
    <DataTable
      rows={vendors}
      getRowKey={(vendor) => vendor.id}
      getRowHref={(vendor) => `/vendors/${vendor.id}`}
      columns={[
        {
          header: "Vendor",
          cell: (vendor) => (
            <div>
              <p className="font-medium text-slate-900">{vendor.name}</p>
              <p className="text-xs text-[var(--muted)]">{vendor.code}</p>
            </div>
          ),
        },
        {
          header: "Contact",
          cell: (vendor) => (
            <div>
              <p>{formatOptional(vendor.email)}</p>
              <p className="text-xs text-[var(--muted)]">{formatOptional(vendor.phone)}</p>
            </div>
          ),
        },
        { header: "GST", cell: (vendor) => formatOptional(vendor.gstNumber) },
        {
          header: "Status",
          cell: (vendor) => (
            <div className="space-y-1">
              <StatusBadge value={vendor.status} />
              <p className="text-xs text-[var(--muted)]">{vendor.isVerified ? "Verified" : "Not verified"}</p>
            </div>
          ),
        },
        { header: "Tenant", cell: (vendor) => `${vendor.servicePartner.name} (${vendor.servicePartner.code})` },
        { header: "Created", cell: (vendor) => formatDateTime(vendor.createdAt) },
      ]}
    />
  );
}
