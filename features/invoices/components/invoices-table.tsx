import { InvoiceStatus } from "@prisma/client";

import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type InvoiceRow = {
  id: string;
  vendorInvoiceNumber: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  invoiceDate: Date;
  receivedDate: Date;
  dueDate: Date | null;
  grandTotal: unknown;
  createdAt: Date;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: string;
  } | null;
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
  };
};

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

export function InvoicesTable({ invoices }: { invoices: InvoiceRow[] }) {
  return (
    <DataTable
      rows={invoices}
      getRowKey={(invoice) => invoice.id}
      getRowHref={(invoice) => `/invoices/${invoice.id}`}
      columns={[
        {
          header: "Vendor Invoice",
          cell: (invoice) => (
            <div>
              <p className="font-medium text-slate-900">{invoice.vendorInvoiceNumber}</p>
              <p className="text-xs text-[var(--muted)]">
                Internal: {invoice.invoiceNumber} | {invoice.vendor.name}
              </p>
            </div>
          ),
        },
        { header: "Status", cell: (invoice) => <StatusBadge value={invoice.status} /> },
        { header: "PO", cell: (invoice) => invoice.purchaseOrder?.poNumber ?? "-" },
        { header: "Service Request", cell: (invoice) => invoice.serviceRequest?.serviceNumber ?? "-" },
        { header: "Lines", cell: (invoice) => invoice._count.items },
        { header: "Invoice Date", cell: (invoice) => formatDateTime(invoice.invoiceDate) },
        { header: "Received Date", cell: (invoice) => formatDateTime(invoice.receivedDate) },
        { header: "Due Date", cell: (invoice) => formatDateTime(invoice.dueDate) },
        { header: "Grand Total", cell: (invoice) => toMoney(invoice.grandTotal) },
        { header: "Tenant", cell: (invoice) => `${invoice.servicePartner.name} (${invoice.servicePartner.code})` },
        { header: "Created", cell: (invoice) => formatDateTime(invoice.createdAt) },
      ]}
    />
  );
}
