import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  createTaskAction,
  createTaskRemarkAction,
  deleteTaskAction,
  updateTaskAction,
} from "@/features/tasks/actions/task.actions";
import { TaskForm } from "@/features/tasks/components/task-form";
import { TaskStatusActions } from "@/features/tasks/components/task-status-actions";
import { TasksTable } from "@/features/tasks/components/tasks-table";
import {
  getTaskById,
  getTaskHistoryEntries,
  listTaskResponsibilityUsers,
} from "@/features/tasks/services/task.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { formatDateTime, formatOptional } from "@/lib/utils/format";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type TaskDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "task-created") {
    return "Sub-task created successfully.";
  }
  if (code === "task-updated") {
    return "Task updated successfully.";
  }
  if (code === "task-status-updated") {
    return "Task status updated successfully.";
  }
  if (code === "task-remark-created") {
    return "Task remark added successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "task-validation") {
    return "Task validation failed.";
  }
  if (code === "task-status-validation") {
    return "Task status update failed.";
  }
  if (code === "task-assignee-mismatch") {
    return "The selected assignee is not valid for this delegation scope.";
  }
  if (code === "task-delegation-blocked") {
    return "Delegation blocked by hierarchy or parent-task access rules.";
  }
  if (code === "task-delete-blocked") {
    return "Delete blocked: child tasks must be cleared before removing the parent task.";
  }
  if (code === "task-remark-validation") {
    return "Task remark validation failed.";
  }
  if (code === "task-not-found") {
    return "Task could not be found.";
  }
  return undefined;
}

export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const session = await requirePermission("tasks.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [task, canUpdate, canDelete, canStatusUpdate, canCreate, canDelegate, canHistoryRead, canRemarkCreate] = await Promise.all([
    getTaskById(session, id),
    hasPermission(session, "tasks.update"),
    hasPermission(session, "tasks.delete"),
    hasPermission(session, "tasks.status.update"),
    hasPermission(session, "tasks.create"),
    hasPermission(session, "tasks.delegate"),
    hasPermission(session, "tasks.history.read"),
    hasPermission(session, "tasks.remark.create"),
  ]);

  if (!task) {
    notFound();
  }

  const taskId = task.id!;
  const taskTitle = task.title!;
  const taskServicePartnerId = task.servicePartnerId!;
  const taskServiceRequestId = task.serviceRequestId!;
  const taskStatus = task.status!;
  const taskTaskNumber = task.taskNumber!;
  const taskAssigneeUserId = task.assigneeUserId ?? null;
  const taskDescription = task.description ?? null;
  const taskRequestedAt = task.requestedAt ?? null;
  const taskStartDate = task.startDate ?? null;
  const taskDueDate = task.dueDate ?? null;
  const taskCompletedAt = task.completedAt ?? null;
  const taskCreatedAt = task.createdAt ?? null;
  const taskServiceRequestSummary = task.serviceRequestSummary;
  const taskAssignmentChain = task.assignmentChain ?? [];
  const taskChildTasks = task.childTasks ?? [];

  const [historyEntries, taskUsers] = await Promise.all([
    canHistoryRead ? getTaskHistoryEntries(session, taskId) : Promise.resolve([]),
    canCreate || canUpdate || canDelegate ? listTaskResponsibilityUsers(session, taskServicePartnerId, taskId) : Promise.resolve([]),
  ]);

  const userOptions = taskUsers.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roles: user.roles,
  }));

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title={taskTitle} description="Review the assignment chain, child tasks, and execution history." />
      <div>
        <Link href="/tasks" className="crm-back-link">
          Back to tasks
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Task summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Task number</dt>
                <dd>{taskTaskNumber}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd><StatusBadge value={taskStatus} /></dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service request</dt>
                <dd>
                  {taskServiceRequestSummary ? (
                    <Link href={`/service-requests/${taskServiceRequestSummary.id}`} className="text-[var(--primary)] underline-offset-2 hover:underline">
                      {taskServiceRequestSummary.serviceNumber}
                    </Link>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Parent task</dt>
                <dd>
                  {task.parentTaskSummary ? (
                    <Link href={`/tasks/${task.parentTaskSummary.id}`} className="text-[var(--primary)] underline-offset-2 hover:underline">
                      {task.parentTaskSummary.taskNumber}
                    </Link>
                  ) : (
                    "Top-level task"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Assigned to</dt>
                <dd>{task.assignee ? task.assignee.name?.trim() || task.assignee.email || task.assignee.phone : "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Assigned by</dt>
                <dd>{task.assignedBy ? task.assignedBy.name?.trim() || task.assignedBy.email || task.assignedBy.phone : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Requested at</dt>
                <dd>{formatDateTime(taskRequestedAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created at</dt>
                <dd>{formatDateTime(taskCreatedAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Due date</dt>
                <dd>{formatDateTime(taskDueDate)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Completed at</dt>
                <dd>{formatDateTime(taskCompletedAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Description</dt>
                <dd>{formatOptional(taskDescription)}</dd>
              </div>
            </dl>
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Assignment chain</h2>
            {taskAssignmentChain.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No assignment chain available.</p>
            ) : (
              <div className="space-y-2">
                {taskAssignmentChain.map((entry) => (
                  <div key={entry} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                    {entry}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="crm-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Child tasks</h2>
              <p className="text-xs text-[var(--muted)]">{taskChildTasks.length} visible child task(s)</p>
            </div>
            {taskChildTasks.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No child tasks visible from this task yet.</p>
            ) : (
              <TasksTable
                serviceRequestId={taskServiceRequestId}
                redirectTo={`/tasks/${taskId}`}
                tasks={taskChildTasks}
                users={userOptions}
                canUpdate={canUpdate}
                canDelete={canDelete}
                canUpdateStatus={canStatusUpdate}
              />
            )}
          </div>

          {canHistoryRead ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Activity and history</h2>
              {historyEntries.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No task history available yet.</p>
              ) : (
                <div className="space-y-3">
                  {historyEntries.map((entry) => (
                    <div key={entry.id} className="rounded-md border border-[var(--border)] px-3 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{entry.action}</p>
                        <p className="text-xs text-[var(--muted)]">{formatDateTime(entry.createdAt)}</p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {entry.actor ? entry.actor.name?.trim() || entry.actor.email || entry.actor.phone : "System"}
                      </p>
                      <p className="mt-2">{entry.message ?? "-"}</p>
                      {entry.metadata ? (
                        <pre className="mt-2 overflow-x-auto rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                          {JSON.stringify(entry.metadata, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          {(canStatusUpdate || canDelete) ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Status</h2>
              {canStatusUpdate ? <TaskStatusActions taskId={taskId} currentStatus={taskStatus} redirectTo={`/tasks/${taskId}`} /> : null}
              {canDelete ? (
                <form action={deleteTaskAction.bind(null, taskId)} className="mt-4">
                  <input type="hidden" name="redirectTo" value="/tasks" />
                  <button type="submit" className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-700">
                    Delete task
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {canUpdate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Edit task</h2>
              <TaskForm
                action={updateTaskAction.bind(null, taskId)}
                serviceRequestId={taskServiceRequestId}
                redirectTo={`/tasks/${taskId}`}
                users={userOptions}
                submitLabel="Update task"
                task={{
                  title: taskTitle,
                  description: taskDescription,
                  assigneeUserId: taskAssigneeUserId,
                  status: taskStatus,
                  requestedAt: taskRequestedAt,
                  startDate: taskStartDate,
                  dueDate: taskDueDate,
                  createdAt: taskCreatedAt,
                }}
              />
            </div>
          ) : null}

          {canDelegate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Delegate / create sub-task</h2>
              <TaskForm
                action={createTaskAction}
                serviceRequestId={taskServiceRequestId}
                parentTaskId={taskId}
                redirectTo={`/tasks/${taskId}`}
                users={userOptions}
                submitLabel="Create sub-task"
              />
            </div>
          ) : null}

          {canRemarkCreate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Add remark</h2>
              <form action={createTaskRemarkAction.bind(null, taskId)} className="space-y-3">
                <input type="hidden" name="redirectTo" value={`/tasks/${taskId}`} />
                <textarea
                  name="remark"
                  maxLength={1000}
                  className="min-h-24 w-full rounded-md border border-[var(--border)] px-3 py-2"
                  placeholder="Add a remark to the task history"
                  required
                />
                <button type="submit" className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium">
                  Add remark
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
