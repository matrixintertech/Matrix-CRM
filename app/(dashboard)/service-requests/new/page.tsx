import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createServiceRequestAction } from "@/features/service-requests/actions/service-request.actions";
import { ServiceRequestForm } from "@/features/service-requests/components/service-request-form";
import {
  listBranchesForServiceRequestForm,
  listClientsForServiceRequestForm,
  listServiceRequestServicePartnersForForm,
} from "@/features/service-requests/services/service-request.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewServiceRequestPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Service number must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Client and branch must belong to the selected tenant.";
  }
  if (code === "not-found") {
    return "Selected client or branch was not found.";
  }
  return undefined;
}

export default async function NewServiceRequestPage({ searchParams }: NewServiceRequestPageProps) {
  const session = await requirePermission("service_requests.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listServiceRequestServicePartnersForForm(session),
  ]);

  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;
  const [clients, branches] = await Promise.all([
    listClientsForServiceRequestForm(session, defaultServicePartnerId),
    listBranchesForServiceRequestForm(session, defaultServicePartnerId),
  ]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Service Request" description="Create a tenant-scoped service request and initialize status timeline." />
      <div>
        <Link href="/service-requests" className="text-sm text-[var(--muted)] underline">
          Back to service requests
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState
          title="No service partner found"
          description="Create or activate a service partner before creating service requests."
        />
      ) : clients.length === 0 ? (
        <EmptyState title="No clients found" description="Create at least one client before creating service requests." />
      ) : (
        <ServiceRequestForm
          action={createServiceRequestAction}
          cancelHref="/service-requests"
          servicePartners={servicePartners}
          clients={clients}
          branches={branches}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}
