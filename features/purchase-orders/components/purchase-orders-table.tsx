import { PurchaseOrderStatus } from "@prisma/client";

import { DataTable } from "@/components/admin/data-table";
import { StatusBadge } from "@/components/admin/status-badge";
import { formatDateTime } from "@/lib/utils/format";

type PurchaseOrderRow = {
  id: string;
  poNumber: string;
  status: PurchaseOrderStatus;
  orderDate: Date;
  expectedDate: Date | null;
  grandTotal: unknown;
  createdAt: Date;
  vendor: {
    id: string;
    code: string;
    name: string;
  };
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

export function PurchaseOrdersTable({ purchaseOrders }: { purchaseOrders: PurchaseOrderRow[] }) {
  return (
    <DataTable
      rows={purchaseOrders}
      getRowKey={(purchaseOrder) => purchaseOrder.id}
      getRowHref={(purchaseOrder) => `/purchase-orders/${purchaseOrder.id}`}
      columns={[
        {
          header: "PO",
          cell: (purchaseOrder) => (
            <div>
              <p className="font-medium text-slate-900">{purchaseOrder.poNumber}</p>
              <p className="text-xs text-[var(--muted)]">{purchaseOrder.vendor.name}</p>
            </div>
          ),
        },
        { header: "Status", cell: (purchaseOrder) => <StatusBadge value={purchaseOrder.status} /> },
        {
          header: "Service Request",
          cell: (purchaseOrder) => (purchaseOrder.serviceRequest ? purchaseOrder.serviceRequest.serviceNumber : "-"),
        },
        { header: "Lines", cell: (purchaseOrder) => purchaseOrder._count.items },
        { header: "Order Date", cell: (purchaseOrder) => formatDateTime(purchaseOrder.orderDate) },
        { header: "Expected Date", cell: (purchaseOrder) => formatDateTime(purchaseOrder.expectedDate) },
        { header: "Grand Total", cell: (purchaseOrder) => toMoney(purchaseOrder.grandTotal) },
        { header: "Tenant", cell: (purchaseOrder) => `${purchaseOrder.servicePartner.name} (${purchaseOrder.servicePartner.code})` },
        { header: "Created", cell: (purchaseOrder) => formatDateTime(purchaseOrder.createdAt) },
      ]}
    />
  );
}
