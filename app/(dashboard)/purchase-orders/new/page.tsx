import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createPurchaseOrderAction } from "@/features/purchase-orders/actions/purchase-order.actions";
import { PurchaseOrderForm } from "@/features/purchase-orders/components/purchase-order-form";
import {
  listItemsForPurchaseOrderForm,
  listPurchaseOrderServicePartnersForForm,
  listRfqsForPurchaseOrderForm,
  listServiceRequestsForPurchaseOrderForm,
  listVendorsForPurchaseOrderForm,
} from "@/features/purchase-orders/services/purchase-order.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewPurchaseOrderPageProps = {
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

export default async function NewPurchaseOrderPage({ searchParams }: NewPurchaseOrderPageProps) {
  const session = await requirePermission("purchase_orders.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listPurchaseOrderServicePartnersForForm(session),
  ]);
  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;

  const [vendors, rfqs, serviceRequests, items] = await Promise.all([
    listVendorsForPurchaseOrderForm(session, defaultServicePartnerId),
    listRfqsForPurchaseOrderForm(session, defaultServicePartnerId),
    listServiceRequestsForPurchaseOrderForm(session, defaultServicePartnerId),
    listItemsForPurchaseOrderForm(session, defaultServicePartnerId),
  ]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create PO" description="Create purchase orders with vendor selection and line items." />
      <div>
        <Link href="/purchase-orders" className="text-sm text-[var(--muted)] underline">
          Back to PO list
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding purchase orders." />
      ) : vendors.length === 0 ? (
        <EmptyState title="No vendors found" description="Create at least one active vendor before adding purchase orders." />
      ) : items.length === 0 ? (
        <EmptyState title="No items found" description="Create at least one active item before adding purchase order lines." />
      ) : (
        <PurchaseOrderForm
          action={createPurchaseOrderAction}
          cancelHref="/purchase-orders"
          servicePartners={servicePartners}
          vendors={vendors}
          rfqs={rfqs}
          serviceRequests={serviceRequests}
          items={items}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}
