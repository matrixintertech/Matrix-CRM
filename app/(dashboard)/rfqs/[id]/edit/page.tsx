import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateRfqAction } from "@/features/rfqs/actions/rfq.actions";
import { RfqForm } from "@/features/rfqs/components/rfq-form";
import {
  getRfqById,
  listClientsForRfqForm,
  listItemsForRfqForm,
  listRfqServicePartnersForForm,
  listServiceRequestsForRfqForm,
  listVendorsForRfqForm,
} from "@/features/rfqs/services/rfq.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditRfqPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "RFQ number already exists for this service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Client, service request, item, and vendor must belong to the selected service partner.";
  }
  return undefined;
}

function toDateInputValue(value: Date | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString().slice(0, 10);
}

export default async function EditRfqPage({ params, searchParams }: EditRfqPageProps) {
  const session = await requirePermission("rfq.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const rfq = await getRfqById(session, id);

  if (!rfq) {
    notFound();
  }

  const [servicePartners, clients, serviceRequests, items, vendors] = await Promise.all([
    listRfqServicePartnersForForm(session),
    listClientsForRfqForm(session),
    listServiceRequestsForRfqForm(session),
    listItemsForRfqForm(session),
    listVendorsForRfqForm(session),
  ]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit RFQ" description="Update RFQ details, line items, and vendor selection." />
      <div>
        <Link href={`/rfqs/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <RfqForm
        action={updateRfqAction.bind(null, id)}
        cancelHref={`/rfqs/${id}`}
        servicePartners={servicePartners}
        clients={clients}
        serviceRequests={serviceRequests}
        items={items}
        vendors={vendors}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        rfq={{
          servicePartnerId: rfq.servicePartnerId,
          clientId: rfq.clientId,
          serviceRequestId: rfq.serviceRequestId,
          title: rfq.title,
          description: rfq.description,
          status: rfq.status,
          dueDate: toDateInputValue(rfq.dueDate),
          lines: rfq.items.map((line) => ({
            itemId: line.itemId,
            description: line.specs,
            quantity: Number(line.quantity).toFixed(3),
            specs: line.specs,
            remarks: line.remarks,
          })),
          vendorQuotes: rfq.vendorQuotes.map((quote) => ({
            vendorId: quote.vendorId,
            status: quote.status,
            quotedAmount: quote.quotedAmount === null ? null : Number(quote.quotedAmount).toFixed(2),
            notes: quote.notes,
          })),
        }}
      />
    </section>
  );
}
