import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updatePurchaseOrderAction } from "@/features/purchase-orders/actions/purchase-order.actions";
import { PurchaseOrderForm } from "@/features/purchase-orders/components/purchase-order-form";
import {
  getPurchaseOrderById,
  listItemsForPurchaseOrderForm,
  listPurchaseOrderServicePartnersForForm,
  listRfqsForPurchaseOrderForm,
  listServiceRequestsForPurchaseOrderForm,
  listVendorsForPurchaseOrderForm,
} from "@/features/purchase-orders/services/purchase-order.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditPurchaseOrderPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "PO number already exists for this service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Vendor, RFQ, service request, and items must belong to the selected service partner.";
  }
  if (code === "invalid-transition") {
    return "PO status transition is not allowed.";
  }
  return undefined;
}

function toDateInputValue(value: Date | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString().slice(0, 10);
}

export default async function EditPurchaseOrderPage({ params, searchParams }: EditPurchaseOrderPageProps) {
  const session = await requirePermission("purchase_orders.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const purchaseOrder = await getPurchaseOrderById(session, id);

  if (!purchaseOrder) {
    notFound();
  }

  const [servicePartners, vendors, rfqs, serviceRequests, items] = await Promise.all([
    listPurchaseOrderServicePartnersForForm(session),
    listVendorsForPurchaseOrderForm(session),
    listRfqsForPurchaseOrderForm(session),
    listServiceRequestsForPurchaseOrderForm(session),
    listItemsForPurchaseOrderForm(session),
  ]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit PO" description="Update purchase order details and line items." />
      <div>
        <Link href={`/purchase-orders/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <PurchaseOrderForm
        action={updatePurchaseOrderAction.bind(null, id)}
        cancelHref={`/purchase-orders/${id}`}
        servicePartners={servicePartners}
        vendors={vendors}
        rfqs={rfqs}
        serviceRequests={serviceRequests}
        items={items}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        purchaseOrder={{
          servicePartnerId: purchaseOrder.servicePartnerId,
          vendorId: purchaseOrder.vendorId,
          rfqId: purchaseOrder.rfqId,
          serviceRequestId: purchaseOrder.serviceRequestId,
          status: purchaseOrder.status,
          orderDate: toDateInputValue(purchaseOrder.orderDate) ?? "",
          expectedDate: toDateInputValue(purchaseOrder.expectedDate),
          notes: purchaseOrder.notes,
          items: purchaseOrder.items.map((line) => ({
            itemId: line.itemId,
            quantity: Number(line.quantity).toFixed(3),
            unitRate: Number(line.unitRate).toFixed(2),
            taxPercent: line.taxPercent === null ? null : Number(line.taxPercent).toFixed(2),
          })),
        }}
      />
    </section>
  );
}
