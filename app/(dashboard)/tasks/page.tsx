import { TaskStatus } from "@prisma/client";

import { EmptyState } from "@/components/admin/empty-state";
import { ExportActions } from "@/components/admin/export-actions";
import { PageHeader } from "@/components/admin/page-header";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { TasksTable } from "@/features/tasks/components/tasks-table";
import {
  listTaskFilterUsers,
  listTaskResponsibilityUsers,
  listTasks,
  listTaskServiceRequestOptions,
} from "@/features/tasks/services/task.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type TasksPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const scopeOptions = [
  { value: "all", label: "All Visible Tasks" },
  { value: "my", label: "My Tasks" },
  { value: "delegated", label: "Delegated By Me" },
  { value: "downline", label: "Team / Downline Tasks" },
  { value: "company", label: "All Company Tasks" },
] as const;

function parseDate(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function getErrorMessage(code?: string) {
  if (code === "task-validation") {
    return "Task validation failed. Check the task details and try again.";
  }
  if (code === "task-status-validation") {
    return "Task status update failed due to an invalid status.";
  }
  if (code === "task-assignee-mismatch") {
    return "The selected assignee is not valid for this tenant or assignment scope.";
  }
  if (code === "task-delegation-blocked") {
    return "Task delegation was blocked by hierarchy or parent-task access rules.";
  }
  if (code === "task-delete-blocked") {
    return "Delete blocked: remove or re-home child tasks before deleting the parent task.";
  }
  if (code === "task-not-found") {
    return "Task could not be found.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "task-created") {
    return "Task created successfully.";
  }
  if (code === "task-updated") {
    return "Task updated successfully.";
  }
  if (code === "task-status-updated") {
    return "Task status updated successfully.";
  }
  if (code === "task-deleted") {
    return "Task deleted successfully.";
  }
  if (code === "task-remark-created") {
    return "Task remark added successfully.";
  }
  return undefined;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const session = await requirePermission("tasks.read");
  const [params, canUpdate, canDelete, canUpdateStatus, canExport, filterUsers, assignableUsers, serviceRequests] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "tasks.update"),
    hasPermission(session, "tasks.delete"),
    hasPermission(session, "tasks.status.update"),
    hasPermission(session, "tasks.export"),
    listTaskFilterUsers(session),
    listTaskResponsibilityUsers(session, session.user.servicePartnerId),
    listTaskServiceRequestOptions(session),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(TaskStatus).find((value) => value === statusParam);
  const assigneeUserId = getStringParam(params, "assigneeUserId");
  const assignedByUserId = getStringParam(params, "assignedByUserId");
  const serviceRequestId = getStringParam(params, "serviceRequestId");
  const scopeParam = getStringParam(params, "scope");
  const scope = scopeOptions.find((option) => option.value === scopeParam)?.value ?? "all";
  const requestedFrom = getStringParam(params, "requestedFrom");
  const requestedTo = getStringParam(params, "requestedTo");
  const dueFrom = getStringParam(params, "dueFrom");
  const dueTo = getStringParam(params, "dueTo");
  const overdue = getStringParam(params, "overdue") === "true";
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listTasks(session, {
    q,
    status,
    assigneeUserId,
    assignedByUserId,
    serviceRequestId,
    scope,
    requestedFrom: parseDate(requestedFrom),
    requestedTo: parseDate(requestedTo),
    dueFrom: parseDate(dueFrom),
    dueTo: parseDate(dueTo),
    overdue,
  });

  const taskUsers = assignableUsers.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roles: user.roles,
  }));

  return (
    <section className="space-y-5">
      <PageHeader
        title="Tasks"
        description="Track personal, delegated, downline, and company-visible task execution."
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {scopeOptions
          .filter((option) => (option.value === "company" ? result.visibility.canSeeCompanyScope : true))
          .map((option) => {
            const next = new URLSearchParams();
            if (q) {
              next.set("q", q);
            }
            if (status) {
              next.set("status", status);
            }
            if (assigneeUserId) {
              next.set("assigneeUserId", assigneeUserId);
            }
            if (assignedByUserId) {
              next.set("assignedByUserId", assignedByUserId);
            }
            if (serviceRequestId) {
              next.set("serviceRequestId", serviceRequestId);
            }
            if (requestedFrom) {
              next.set("requestedFrom", requestedFrom);
            }
            if (requestedTo) {
              next.set("requestedTo", requestedTo);
            }
            if (dueFrom) {
              next.set("dueFrom", dueFrom);
            }
            if (dueTo) {
              next.set("dueTo", dueTo);
            }
            if (overdue) {
              next.set("overdue", "true");
            }
            next.set("scope", option.value);

            return (
              <PrefetchLink
                key={option.value}
                href={`/tasks?${next.toString()}`}
                className={`rounded-xl border px-3 py-2.5 text-center text-sm ${scope === option.value ? "border-[var(--primary)] text-[var(--primary)]" : "border-[var(--border)]"}`}
              >
                {option.label}
              </PrefetchLink>
            );
          })}
      </div>

      <form className="grid gap-3 rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm md:grid-cols-3" action="">
        <label className="space-y-1 text-sm md:col-span-3">
          <span className="font-medium">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search by task number, title, assignee, assigner, or service request"
            className="h-10 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <input type="hidden" name="scope" value={scope} />
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select name="status" defaultValue={status ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3">
            <option value="">All statuses</option>
            {Object.values(TaskStatus).map((statusValue) => (
              <option key={statusValue} value={statusValue}>
                {statusValue}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Assigned To</span>
          <select name="assigneeUserId" defaultValue={assigneeUserId ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3">
            <option value="">All assignees</option>
            {filterUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name?.trim() || user.email || user.phone || user.id}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Assigned By</span>
          <select name="assignedByUserId" defaultValue={assignedByUserId ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3">
            <option value="">All assigners</option>
            {filterUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name?.trim() || user.email || user.phone || user.id}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm md:col-span-3">
          <span className="font-medium">Service Request</span>
          <select name="serviceRequestId" defaultValue={serviceRequestId ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3">
            <option value="">All service requests</option>
            {serviceRequests.map((serviceRequest) => (
              <option key={serviceRequest.id} value={serviceRequest.id}>
                {serviceRequest.serviceNumber} - {serviceRequest.title}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Requested From</span>
          <input type="date" name="requestedFrom" defaultValue={requestedFrom ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Requested To</span>
          <input type="date" name="requestedTo" defaultValue={requestedTo ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Overdue Only</span>
          <select name="overdue" defaultValue={overdue ? "true" : "false"} className="h-10 w-full rounded-md border border-[var(--border)] px-3">
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Due From</span>
          <input type="date" name="dueFrom" defaultValue={dueFrom ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Due To</span>
          <input type="date" name="dueTo" defaultValue={dueTo ?? ""} className="h-10 w-full rounded-md border border-[var(--border)] px-3" />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end md:col-span-3">
          <button type="submit" className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-medium">
            Apply Filters
          </button>
          {canExport ? (
            <ExportActions
              moduleKey="tasks"
              query={{
                q,
                status,
                assigneeUserId,
                assignedByUserId,
                serviceRequestId,
                scope,
                requestedFrom,
                requestedTo,
                dueFrom,
                dueTo,
                overdue: overdue ? "true" : undefined,
              }}
            />
          ) : null}
        </div>
      </form>

      {result.tasks.length === 0 ? (
        <EmptyState title="No tasks found" description="Try another scope or adjust the task filters." />
      ) : (
        <TasksTable
          serviceRequestId=""
          redirectTo="/tasks"
          tasks={result.tasks}
          users={taskUsers}
          canUpdate={canUpdate}
          canDelete={canDelete}
          canUpdateStatus={canUpdateStatus}
          showServiceRequest
        />
      )}
    </section>
  );
}
