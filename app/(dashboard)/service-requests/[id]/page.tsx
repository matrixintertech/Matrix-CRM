import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { ServiceRequestStatusActions } from "@/features/service-requests/components/service-request-status-actions";
import { ServiceRequestSummaryCard } from "@/features/service-requests/components/service-request-summary-card";
import { ServiceRequestTimeline } from "@/features/service-requests/components/service-request-timeline";
import { getServiceRequestById } from "@/features/service-requests/services/service-request.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ServiceRequestDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Service request created successfully.";
  }
  if (code === "updated") {
    return "Service request updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function ServiceRequestDetailPage({ params, searchParams }: ServiceRequestDetailPageProps) {
  const session = await requirePermission("service_requests.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const serviceRequest = await getServiceRequestById(session, id);

  if (!serviceRequest) {
    notFound();
  }

  const [canUpdate, canDelete] = await Promise.all([
    hasPermission(session, "service_requests.update"),
    hasPermission(session, "service_requests.delete"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={serviceRequest.title}
        description="Review service request details, status, and timeline."
        action={canUpdate ? { label: "Edit service request", href: `/service-requests/${serviceRequest.id}/edit` } : undefined}
      />
      <div>
        <Link href="/service-requests" className="text-sm text-[var(--muted)] underline">
          Back to service requests
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <ServiceRequestSummaryCard serviceRequest={serviceRequest} />
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Status timeline</h2>
            <ServiceRequestTimeline entries={serviceRequest.statusHistory} />
          </div>
        </div>

        {canUpdate ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
            <ServiceRequestStatusActions
              serviceRequestId={serviceRequest.id}
              currentStatus={serviceRequest.status}
              canDelete={canDelete}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
