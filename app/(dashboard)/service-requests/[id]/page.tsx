import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { ServiceRequestResponsibilityCard } from "@/features/service-requests/components/service-request-responsibility-card";
import { ServiceRequestStatusActions } from "@/features/service-requests/components/service-request-status-actions";
import { ServiceRequestSummaryCard } from "@/features/service-requests/components/service-request-summary-card";
import { ServiceRequestTimeline } from "@/features/service-requests/components/service-request-timeline";
import {
  getServiceRequestResponsibilities,
  listResponsibilityCandidates,
} from "@/features/service-requests/services/service-request-responsibility.service";
import { getServiceRequestById } from "@/features/service-requests/services/service-request.service";
import { createTaskAction } from "@/features/tasks/actions/task.actions";
import { TaskForm } from "@/features/tasks/components/task-form";
import { TasksTable } from "@/features/tasks/components/tasks-table";
import { listTaskResponsibilityUsers, listTasksForServiceRequest } from "@/features/tasks/services/task.service";
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
  if (code === "responsibility-updated") {
    return "Service request responsibility updated successfully.";
  }
  if (code === "task-created") {
    return "Work item created successfully.";
  }
  if (code === "task-updated") {
    return "Work item updated successfully.";
  }
  if (code === "task-status-updated") {
    return "Work item status updated successfully.";
  }
  if (code === "task-deleted") {
    return "Work item deleted successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  if (code === "responsibility-mismatch") {
    return "Responsibility update blocked: selected user must belong to this company and be active.";
  }
  if (code === "responsibility-not-found") {
    return "Responsibility update failed: service request was not found.";
  }
  if (code === "task-validation") {
    return "Work item validation failed. Check title, status, dates, and responsible user.";
  }
  if (code === "task-status-validation") {
    return "Work item status update failed due to invalid status.";
  }
  if (code === "task-assignee-mismatch") {
    return "Work item update blocked: responsible user must belong to this company and be active.";
  }
  if (code === "task-service-request-not-found") {
    return "Work item creation failed: service request was not found.";
  }
  if (code === "task-not-found") {
    return "Work item could not be found.";
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

  const [
    canUpdate,
    canDelete,
    canResponsibilityRead,
    canResponsibilityUpdate,
    canTaskRead,
    canTaskCreate,
    canTaskUpdate,
    canTaskDelete,
    canTaskStatusUpdate,
  ] = await Promise.all([
    hasPermission(session, "service_requests.update"),
    hasPermission(session, "service_requests.delete"),
    hasPermission(session, "service_requests.responsibility.read"),
    hasPermission(session, "service_requests.responsibility.update"),
    hasPermission(session, "tasks.read"),
    hasPermission(session, "tasks.create"),
    hasPermission(session, "tasks.update"),
    hasPermission(session, "tasks.delete"),
    hasPermission(session, "tasks.status.update"),
  ]);

  const [responsibility, taskBundle, taskUsers] = await Promise.all([
    canResponsibilityRead ? getServiceRequestResponsibilities(session, serviceRequest.id) : Promise.resolve(null),
    canTaskRead ? listTasksForServiceRequest(session, serviceRequest.id) : Promise.resolve(null),
    canResponsibilityUpdate || canTaskCreate || canTaskUpdate
      ? listTaskResponsibilityUsers(session, serviceRequest.servicePartnerId)
      : Promise.resolve([]),
  ]);
  const responsibilityCandidates = canResponsibilityUpdate
    ? await listResponsibilityCandidates(session, serviceRequest.servicePartnerId)
    : [];

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

          {canResponsibilityRead && responsibility ? (
            <ServiceRequestResponsibilityCard
              serviceRequestId={serviceRequest.id}
              snapshot={responsibility.snapshot}
              candidates={responsibilityCandidates}
              canUpdate={canResponsibilityUpdate}
            />
          ) : (
            <div className="rounded-md border border-[var(--border)] bg-white p-5">
              <h2 className="mb-2 text-base font-semibold">Responsibility</h2>
              <p className="text-sm text-[var(--muted)]">You do not have permission to view service request responsibility.</p>
            </div>
          )}

          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Work Items</h2>
            {canTaskRead && taskBundle ? (
              <TasksTable
                serviceRequestId={serviceRequest.id}
                redirectTo={`/service-requests/${serviceRequest.id}`}
                tasks={taskBundle.tasks}
                users={taskUsers}
                canUpdate={canTaskUpdate}
                canDelete={canTaskDelete}
                canUpdateStatus={canTaskStatusUpdate}
              />
            ) : (
              <p className="text-sm text-[var(--muted)]">You do not have permission to view work items.</p>
            )}

            {canTaskCreate ? (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">Add Work Item</h3>
                <TaskForm
                  action={createTaskAction}
                  serviceRequestId={serviceRequest.id}
                  redirectTo={`/service-requests/${serviceRequest.id}`}
                  users={taskUsers}
                  submitLabel="Create work item"
                />
              </div>
            ) : null}
          </div>

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
