import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createRfqAction } from "@/features/rfqs/actions/rfq.actions";
import { RfqForm } from "@/features/rfqs/components/rfq-form";
import {
  listClientsForRfqForm,
  listItemsForRfqForm,
  listRfqServicePartnersForForm,
  listServiceRequestsForRfqForm,
  listVendorsForRfqForm,
} from "@/features/rfqs/services/rfq.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewRfqPageProps = {
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

export default async function NewRfqPage({ searchParams }: NewRfqPageProps) {
  const session = await requirePermission("rfq.create");
  const [params, servicePartners] = await Promise.all([resolveSearchParams(searchParams), listRfqServicePartnersForForm(session)]);
  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;

  const [clients, serviceRequests, items, vendors] = await Promise.all([
    listClientsForRfqForm(session, defaultServicePartnerId),
    listServiceRequestsForRfqForm(session, defaultServicePartnerId),
    listItemsForRfqForm(session, defaultServicePartnerId),
    listVendorsForRfqForm(session, defaultServicePartnerId),
  ]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create RFQ" description="Create an RFQ with line items and vendor invitations." />
      <div>
        <Link href="/rfqs" className="text-sm text-[var(--muted)] underline">
          Back to RFQs
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding RFQs." />
      ) : items.length === 0 ? (
        <EmptyState title="No items found" description="Create at least one active item before adding RFQ lines." />
      ) : vendors.length === 0 ? (
        <EmptyState title="No vendors found" description="Create at least one vendor before assigning RFQ vendors." />
      ) : (
        <RfqForm
          action={createRfqAction}
          cancelHref="/rfqs"
          servicePartners={servicePartners}
          clients={clients}
          serviceRequests={serviceRequests}
          items={items}
          vendors={vendors}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}
