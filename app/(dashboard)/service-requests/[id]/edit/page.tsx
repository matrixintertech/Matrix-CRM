import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateServiceRequestAction } from "@/features/service-requests/actions/service-request.actions";
import { ServiceRequestForm } from "@/features/service-requests/components/service-request-form";
import {
  getServiceRequestById,
  listBranchesForServiceRequestForm,
  listClientsForServiceRequestForm,
  listServiceRequestServicePartnersForForm,
} from "@/features/service-requests/services/service-request.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditServiceRequestPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
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

function toDateInputValue(value: Date | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toISOString().slice(0, 10);
}

export default async function EditServiceRequestPage({ params, searchParams }: EditServiceRequestPageProps) {
  const session = await requirePermission("service_requests.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const serviceRequest = await getServiceRequestById(session, id);

  if (!serviceRequest) {
    notFound();
  }

  const [servicePartners, clients, branches] = await Promise.all([
    listServiceRequestServicePartnersForForm(session),
    listClientsForServiceRequestForm(session),
    listBranchesForServiceRequestForm(session),
  ]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Service Request" description="Update basic service request information." />
      <div>
        <Link href={`/service-requests/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <ServiceRequestForm
        action={updateServiceRequestAction.bind(null, id)}
        cancelHref={`/service-requests/${id}`}
        servicePartners={servicePartners}
        clients={clients}
        branches={branches}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        serviceRequest={{
          servicePartnerId: serviceRequest.servicePartnerId,
          serviceNumber: serviceRequest.serviceNumber,
          clientId: serviceRequest.clientId,
          branchId: serviceRequest.branchId,
          title: serviceRequest.title,
          description: serviceRequest.description,
          serviceType: serviceRequest.serviceType,
          status: serviceRequest.status,
          requestedAt: toDateInputValue(serviceRequest.requestedAt),
          targetDate: toDateInputValue(serviceRequest.targetDate),
        }}
      />
    </section>
  );
}
