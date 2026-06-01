import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createInvoiceAction } from "@/features/invoices/actions/invoice.actions";
import { InvoiceForm } from "@/features/invoices/components/invoice-form";
import {
  listInvoiceServicePartnersForForm,
  listItemsForInvoiceForm,
  listPurchaseOrdersForInvoiceForm,
  listRfqsForInvoiceForm,
  listServiceRequestsForInvoiceForm,
  listVendorsForInvoiceForm,
} from "@/features/invoices/services/invoice.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewInvoicePageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Invoice number already exists for this service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Vendor, purchase order, RFQ, service request, and items must belong to the selected service partner.";
  }
  if (code === "invalid-transition") {
    return "Invoice status transition is not allowed.";
  }
  return undefined;
}

export default async function NewInvoicePage({ searchParams }: NewInvoicePageProps) {
  const session = await requirePermission("invoices.create");
  const [params, servicePartners] = await Promise.all([resolveSearchParams(searchParams), listInvoiceServicePartnersForForm(session)]);
  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const requestedPurchaseOrderId = getStringParam(params, "purchaseOrderId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;

  const [vendors, purchaseOrders, rfqs, serviceRequests, items] = await Promise.all([
    listVendorsForInvoiceForm(session, defaultServicePartnerId),
    listPurchaseOrdersForInvoiceForm(session, defaultServicePartnerId),
    listRfqsForInvoiceForm(session, defaultServicePartnerId),
    listServiceRequestsForInvoiceForm(session, defaultServicePartnerId),
    listItemsForInvoiceForm(session, defaultServicePartnerId),
  ]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Invoice" description="Create invoice with line items and optional PO linkage." />
      <div>
        <Link href="/invoices" className="text-sm text-[var(--muted)] underline">
          Back to invoice list
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding invoices." />
      ) : vendors.length === 0 ? (
        <EmptyState title="No vendors found" description="Create at least one active vendor before adding invoices." />
      ) : items.length === 0 ? (
        <EmptyState title="No items found" description="Create at least one active item before adding invoice lines." />
      ) : (
        <InvoiceForm
          action={createInvoiceAction}
          cancelHref="/invoices"
          servicePartners={servicePartners}
          vendors={vendors}
          purchaseOrders={purchaseOrders}
          rfqs={rfqs}
          serviceRequests={serviceRequests}
          items={items}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
          defaultPurchaseOrderId={requestedPurchaseOrderId}
        />
      )}
    </section>
  );
}
