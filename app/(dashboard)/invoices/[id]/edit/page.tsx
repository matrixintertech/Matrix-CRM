import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateInvoiceAction } from "@/features/invoices/actions/invoice.actions";
import { InvoiceForm } from "@/features/invoices/components/invoice-form";
import {
  getInvoiceById,
  listInvoiceServicePartnersForForm,
  listItemsForInvoiceForm,
  listPurchaseOrdersForInvoiceForm,
  listRfqsForInvoiceForm,
  listServiceRequestsForInvoiceForm,
  listVendorsForInvoiceForm,
} from "@/features/invoices/services/invoice.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditInvoicePageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Vendor invoice number already exists for this vendor.";
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
  if (code === "edit-blocked") {
    return "Invoice cannot be edited in the current status.";
  }
  return undefined;
}

function toDateInputValue(value: Date | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString().slice(0, 10);
}

export default async function EditInvoicePage({ params, searchParams }: EditInvoicePageProps) {
  const session = await requirePermission("invoices.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const invoice = await getInvoiceById(session, id);

  if (!invoice) {
    notFound();
  }

  const [servicePartners, vendors, purchaseOrders, rfqs, serviceRequests, items] = await Promise.all([
    listInvoiceServicePartnersForForm(session),
    listVendorsForInvoiceForm(session),
    listPurchaseOrdersForInvoiceForm(session),
    listRfqsForInvoiceForm(session),
    listServiceRequestsForInvoiceForm(session),
    listItemsForInvoiceForm(session),
  ]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Received Invoice" description="Update received vendor invoice details and line items." />
      <div>
        <Link href={`/invoices/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <InvoiceForm
        action={updateInvoiceAction.bind(null, id)}
        cancelHref={`/invoices/${id}`}
        servicePartners={servicePartners}
        vendors={vendors}
        purchaseOrders={purchaseOrders}
        rfqs={rfqs}
        serviceRequests={serviceRequests}
        items={items}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        invoice={{
          invoiceNumber: invoice.invoiceNumber,
          vendorInvoiceNumber: invoice.vendorInvoiceNumber,
          servicePartnerId: invoice.servicePartnerId,
          vendorId: invoice.vendorId,
          purchaseOrderId: invoice.purchaseOrderId,
          rfqId: invoice.rfqId,
          serviceRequestId: invoice.serviceRequestId,
          status: invoice.status,
          invoiceDate: toDateInputValue(invoice.invoiceDate) ?? "",
          receivedDate: toDateInputValue(invoice.receivedDate) ?? "",
          dueDate: toDateInputValue(invoice.dueDate),
          notes: invoice.notes,
          items: invoice.items.map((line) => ({
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
