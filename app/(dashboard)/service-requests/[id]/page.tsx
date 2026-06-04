import Link from "next/link";
import { notFound } from "next/navigation";

import { ExportActions } from "@/components/admin/export-actions";
import { PageHeader } from "@/components/admin/page-header";
import { createQuotationAction } from "@/features/quotations/actions/quotation.actions";
import { QuotationForm } from "@/features/quotations/components/quotation-form";
import { QuotationSummaryCard } from "@/features/quotations/components/quotation-summary-card";
import { QuotationsTable } from "@/features/quotations/components/quotations-table";
import {
  listQuotationItemOptions,
  listQuotationsForServiceRequest,
} from "@/features/quotations/services/quotation.service";
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
  if (code === "quotation-created") {
    return "Quotation created successfully.";
  }
  if (code === "quotation-updated") {
    return "Quotation updated successfully.";
  }
  if (code === "quotation-status-updated") {
    return "Quotation status updated successfully.";
  }
  if (code === "quotation-submitted") {
    return "Quotation submitted successfully.";
  }
  if (code === "quotation-deleted") {
    return "Quotation deleted successfully.";
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
  if (code === "task-delegation-blocked") {
    return "Task delegation was blocked by hierarchy or parent-task access rules.";
  }
  if (code === "task-service-request-not-found") {
    return "Work item creation failed: service request was not found.";
  }
  if (code === "task-not-found") {
    return "Work item could not be found.";
  }
  if (code === "quotation-validation") {
    return "Quotation validation failed. Check dates and line values.";
  }
  if (code === "quotation-status-validation") {
    return "Quotation status update failed due to invalid status.";
  }
  if (code === "quotation-mismatch") {
    return "Quotation update blocked: line items must belong to this company and be active.";
  }
  if (code === "quotation-not-found") {
    return "Quotation could not be found.";
  }
  if (code === "quotation-duplicate") {
    return "A quotation already exists for this service request.";
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
    canStatusUpdate,
    canResponsibilityRead,
    canResponsibilityUpdate,
    canTaskRead,
    canTaskCreate,
    canTaskUpdate,
    canTaskDelete,
    canTaskStatusUpdate,
    canTaskExport,
    canQuotationRead,
    canQuotationCreate,
    canQuotationUpdate,
    canQuotationDelete,
    canQuotationStatusUpdate,
    canQuotationSubmit,
    canQuotationExport,
  ] = await Promise.all([
    hasPermission(session, "service_requests.update"),
    hasPermission(session, "service_requests.delete"),
    hasPermission(session, "service_requests.status.update"),
    hasPermission(session, "service_requests.responsibility.read"),
    hasPermission(session, "service_requests.responsibility.update"),
    hasPermission(session, "tasks.read"),
    hasPermission(session, "tasks.create"),
    hasPermission(session, "tasks.update"),
    hasPermission(session, "tasks.delete"),
    hasPermission(session, "tasks.status.update"),
    hasPermission(session, "tasks.export"),
    hasPermission(session, "quotations.read"),
    hasPermission(session, "quotations.create"),
    hasPermission(session, "quotations.update"),
    hasPermission(session, "quotations.delete"),
    hasPermission(session, "quotations.status.update"),
    hasPermission(session, "quotations.submit"),
    hasPermission(session, "quotations.export"),
  ]);

  const [responsibility, taskBundle, taskUsers, quotationBundle, quotationItemOptions] = await Promise.all([
    canResponsibilityRead ? getServiceRequestResponsibilities(session, serviceRequest.id) : Promise.resolve(null),
    canTaskRead ? listTasksForServiceRequest(session, serviceRequest.id) : Promise.resolve(null),
    canResponsibilityUpdate || canTaskCreate || canTaskUpdate
      ? listTaskResponsibilityUsers(session, serviceRequest.servicePartnerId)
      : Promise.resolve([]),
    canQuotationRead ? listQuotationsForServiceRequest(session, serviceRequest.id) : Promise.resolve(null),
    canQuotationCreate || canQuotationUpdate
      ? listQuotationItemOptions(session, serviceRequest.id)
      : Promise.resolve([]),
  ]);
  const responsibilityCandidates = canResponsibilityUpdate
    ? await listResponsibilityCandidates(session, serviceRequest.servicePartnerId)
    : [];
  const mappedQuotations =
    quotationBundle?.quotations.map((quotation) => ({
      ...quotation,
      subtotal: Number(quotation.subtotal),
      taxTotal: Number(quotation.taxTotal),
      grandTotal: Number(quotation.grandTotal),
      items: quotation.items.map((line) => ({
        ...line,
        quantity: Number(line.quantity),
        unitRate: Number(line.unitRate),
        taxPercent: line.taxPercent === null ? null : Number(line.taxPercent),
        amount: Number(line.amount),
      })),
    })) ?? [];
  const canCreateNewQuotation = canQuotationRead && canQuotationCreate && mappedQuotations.length === 0;

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="crm-page">
      <PageHeader
        title={serviceRequest.title}
        description="Review service request details, status, and timeline."
        action={canUpdate ? { label: "Edit service request", href: `/service-requests/${serviceRequest.id}/edit` } : undefined}
      />
      <div>
        <Link href="/service-requests" className="crm-back-link">
          Back to service requests
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

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
            <div className="crm-panel">
              <h2 className="mb-2 text-base font-semibold">Responsibility</h2>
              <p className="text-sm text-[var(--muted)]">You do not have permission to view service request responsibility.</p>
            </div>
          )}

          <div className="crm-panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Work Items</h2>
              {canTaskRead && canTaskExport ? <ExportActions moduleKey="tasks" query={{ serviceRequestId: serviceRequest.id }} /> : null}
            </div>
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
                <p className="mb-3 text-xs text-[var(--muted)]">
                  Create top-level tasks here. Use an individual task detail page to delegate sub-tasks and view the full assignment chain.
                </p>
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

          <div className="crm-panel">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Quotations</h2>
              {canQuotationRead && canQuotationExport ? <ExportActions moduleKey="quotations" query={{ q: serviceRequest.serviceNumber }} /> : null}
            </div>
            {canQuotationRead && quotationBundle ? (
              <div className="space-y-4">
                <QuotationSummaryCard quotations={mappedQuotations} />
                <QuotationsTable
                  serviceRequestId={serviceRequest.id}
                  redirectTo={`/service-requests/${serviceRequest.id}`}
                  quotations={mappedQuotations}
                  itemOptions={quotationItemOptions}
                  canUpdate={canQuotationUpdate}
                  canDelete={canQuotationDelete}
                  canUpdateStatus={canQuotationStatusUpdate}
                  canSubmit={canQuotationSubmit}
                />
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">You do not have permission to view quotations.</p>
            )}

            {canCreateNewQuotation ? (
              <div className="mt-4">
                <h3 className="mb-2 text-sm font-semibold">Add Quotation</h3>
                <QuotationForm
                  action={createQuotationAction}
                  serviceRequestId={serviceRequest.id}
                  redirectTo={`/service-requests/${serviceRequest.id}`}
                  itemOptions={quotationItemOptions}
                  submitLabel="Create quotation"
                />
              </div>
            ) : null}
            {!canCreateNewQuotation && canQuotationRead && canQuotationCreate && mappedQuotations.length > 0 ? (
              <p className="mt-3 text-xs text-[var(--muted)]">
                Only one quotation is allowed per service request in the current milestone.
              </p>
            ) : null}
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Status timeline</h2>
            <ServiceRequestTimeline entries={serviceRequest.statusHistory} />
          </div>
        </div>

        {canStatusUpdate || canDelete ? (
          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
            <ServiceRequestStatusActions
              serviceRequestId={serviceRequest.id}
              currentStatus={serviceRequest.status}
              canUpdateStatus={canStatusUpdate}
              canDelete={canDelete}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
