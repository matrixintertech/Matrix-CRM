import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import {
  checkInToTaskAction,
  checkOutOfTaskAction,
  createTaskAction,
  deleteTaskAttachmentAction,
  createTaskRemarkAction,
  deleteTaskAction,
  uploadTaskAttachmentAction,
  updateTaskAction,
} from "@/features/tasks/actions/task.actions";
import { TaskForm } from "@/features/tasks/components/task-form";
import { TaskStatusActions } from "@/features/tasks/components/task-status-actions";
import { TaskWorkSessionForm } from "@/features/tasks/components/task-work-session-form";
import { TasksTable } from "@/features/tasks/components/tasks-table";
import {
  getTaskById,
  getTaskHistoryEntries,
  listTaskResponsibilityUsers,
} from "@/features/tasks/services/task.service";
import { getTaskWorkSessionBundle } from "@/features/tasks/services/task-work-session.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { env } from "@/lib/config/env";
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
  if (code === "task-checked-in") {
    return "Task check-in recorded successfully.";
  }
  if (code === "task-checked-out") {
    return "Task check-out recorded successfully.";
  }
  if (code === "task-attachment-uploaded") {
    return "Task proof uploaded successfully.";
  }
  if (code === "task-attachment-deleted") {
    return "Task proof deleted successfully.";
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
  if (code === "task-checkin-validation") {
    return "Task check-in validation failed.";
  }
  if (code === "task-checkout-validation") {
    return "Task check-out validation failed.";
  }
  if (code === "task-checkin-active") {
    return "You already have an active check-in for this task.";
  }
  if (code === "task-checkout-missing") {
    return "No active check-in was found for this task.";
  }
  if (code === "task-location-required") {
    return "Location permission is required to complete this action.";
  }
  if (code === "task-checkin-assignee-only" || code === "task-checkout-assignee-only") {
    return "Only the assigned user can check in or check out for this task.";
  }
  if (code === "task-attachment-validation") {
    return "Task proof upload failed validation. Check the file type and size.";
  }
  if (code === "task-attachment-storage") {
    return "Task proof uploads are not configured for this environment.";
  }
  if (code === "task-attachment-not-found") {
    return "Task proof could not be found.";
  }
  if (code === "task-not-found") {
    return "Task could not be found.";
  }
  return undefined;
}

function formatDurationMinutes(value: number | null) {
  if (value === null) {
    return "-";
  }
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function buildMapLink(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) {
    return null;
  }
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

export default async function TaskDetailPage({ params, searchParams }: TaskDetailPageProps) {
  const session = await requirePermission("tasks.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [
    task,
    canUpdate,
    canDelete,
    canStatusUpdate,
    canCreate,
    canDelegate,
    canHistoryRead,
    canRemarkCreate,
    canCheckIn,
    canCheckOut,
    canAttachmentUpload,
    canAttachmentDelete,
  ] = await Promise.all([
    getTaskById(session, id),
    hasPermission(session, "tasks.update"),
    hasPermission(session, "tasks.delete"),
    hasPermission(session, "tasks.status.update"),
    hasPermission(session, "tasks.create"),
    hasPermission(session, "tasks.delegate"),
    hasPermission(session, "tasks.history.read"),
    hasPermission(session, "tasks.remark.create"),
    hasPermission(session, "tasks.check_in"),
    hasPermission(session, "tasks.check_out"),
    hasPermission(session, "tasks.attachments.upload"),
    hasPermission(session, "tasks.attachments.delete"),
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
  const canSelfExecuteTask = session.user.isSuperAdmin || taskAssigneeUserId === session.user.id;
  const locationRequired = env().TASK_LOCATION_REQUIRED;

  const [historyEntries, taskUsers, taskWorkBundle] = await Promise.all([
    canHistoryRead ? getTaskHistoryEntries(session, taskId) : Promise.resolve([]),
    canCreate || canUpdate || canDelegate ? listTaskResponsibilityUsers(session, taskServicePartnerId, taskId) : Promise.resolve([]),
    getTaskWorkSessionBundle(session, taskId),
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
              <div>
                <dt className="text-[var(--muted)]">Active work sessions</dt>
                <dd>{taskWorkBundle.summary.activeSessionCount}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Proof uploads</dt>
                <dd>{taskWorkBundle.summary.proofCount}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Description</dt>
                <dd>{formatOptional(taskDescription)}</dd>
              </div>
            </dl>
          </div>

          <div className="crm-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Work session</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Check in when work starts and check out when it pauses or completes.</p>
              </div>
              {taskWorkBundle.currentUserActiveSession ? <StatusBadge value="CHECKED_IN" /> : <StatusBadge value="YET_TO_START" />}
            </div>

            {taskWorkBundle.currentUserActiveSession ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Checked In</p>
                    <p className="mt-1 text-slate-900">{formatDateTime(taskWorkBundle.currentUserActiveSession.checkInAt)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Location</p>
                    <p className="mt-1 text-slate-900">
                      {taskWorkBundle.currentUserActiveSession.checkInLatitude !== null &&
                      taskWorkBundle.currentUserActiveSession.checkInLongitude !== null
                        ? "Available"
                        : "Not available"}
                    </p>
                    {buildMapLink(
                      taskWorkBundle.currentUserActiveSession.checkInLatitude,
                      taskWorkBundle.currentUserActiveSession.checkInLongitude
                    ) ? (
                      <Link
                        href={
                          buildMapLink(
                            taskWorkBundle.currentUserActiveSession.checkInLatitude,
                            taskWorkBundle.currentUserActiveSession.checkInLongitude
                          )!
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-[var(--primary)] underline-offset-2 hover:underline"
                      >
                        Open check-in map
                      </Link>
                    ) : null}
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Check-in Note</p>
                    <p className="mt-1 text-slate-900">{formatOptional(taskWorkBundle.currentUserActiveSession.checkInNote)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
                No active check-in for your account on this task.
              </p>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {canCheckIn && canSelfExecuteTask ? (
                <div className="rounded-2xl border border-[var(--border)] p-4">
                  <h3 className="text-sm font-semibold">Check In</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">Starts a task work session and records the current time automatically.</p>
                  <div className="mt-3">
                    <TaskWorkSessionForm
                      action={checkInToTaskAction.bind(null, taskId)}
                      redirectTo={`/tasks/${taskId}`}
                      buttonLabel="Check In"
                      noteLabel="Check-in remark"
                      notePlaceholder="Add a start-of-work note"
                      locationRequired={locationRequired}
                      disabled={Boolean(taskWorkBundle.currentUserActiveSession)}
                    />
                  </div>
                </div>
              ) : null}

              {canCheckOut && canSelfExecuteTask ? (
                <div className="rounded-2xl border border-[var(--border)] p-4">
                  <h3 className="text-sm font-semibold">Check Out</h3>
                  <p className="mt-1 text-xs text-[var(--muted)]">Closes the active task session and captures end-of-work notes.</p>
                  <div className="mt-3">
                    <TaskWorkSessionForm
                      action={checkOutOfTaskAction.bind(null, taskId)}
                      redirectTo={`/tasks/${taskId}`}
                      buttonLabel="Check Out"
                      noteLabel="Check-out remark"
                      notePlaceholder="Add a completion or pause note"
                      locationRequired={locationRequired}
                      disabled={!taskWorkBundle.currentUserActiveSession}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Session history</h3>
                <p className="text-xs text-[var(--muted)]">{taskWorkBundle.sessions.length} visible session(s)</p>
              </div>
              {taskWorkBundle.sessions.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No task work sessions are visible for this task yet.</p>
              ) : (
                <div className="space-y-3">
                  {taskWorkBundle.sessions.map((entry) => {
                    const checkInMapLink = buildMapLink(entry.checkInLatitude, entry.checkInLongitude);
                    const checkOutMapLink = buildMapLink(entry.checkOutLatitude, entry.checkOutLongitude);

                    return (
                      <article key={entry.id} className="rounded-2xl border border-[var(--border)] p-4 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">{entry.user.name?.trim() || entry.user.email || entry.user.phone || entry.user.id}</p>
                            <p className="text-xs text-[var(--muted)]">{entry.status}</p>
                          </div>
                          <p className="text-xs text-[var(--muted)]">Duration: {formatDurationMinutes(entry.durationMinutes)}</p>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Check In</p>
                            <p className="mt-1">{formatDateTime(entry.checkInAt)}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {entry.checkInLatitude !== null && entry.checkInLongitude !== null ? "Location available" : "Location unavailable"}
                            </p>
                            {checkInMapLink ? (
                              <Link href={checkInMapLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--primary)] underline-offset-2 hover:underline">
                                Open check-in map
                              </Link>
                            ) : null}
                            <p className="mt-1 text-xs text-slate-700">{formatOptional(entry.checkInNote)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Check Out</p>
                            <p className="mt-1">{formatDateTime(entry.checkOutAt)}</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {entry.checkOutLatitude !== null && entry.checkOutLongitude !== null ? "Location available" : "Location unavailable"}
                            </p>
                            {checkOutMapLink ? (
                              <Link href={checkOutMapLink} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[var(--primary)] underline-offset-2 hover:underline">
                                Open check-out map
                              </Link>
                            ) : null}
                            <p className="mt-1 text-xs text-slate-700">{formatOptional(entry.checkOutNote)}</p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="crm-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">Proof uploads</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">Upload images or PDFs as task completion proof.</p>
              </div>
              <p className="text-xs text-[var(--muted)]">{taskWorkBundle.summary.proofCount} file(s)</p>
            </div>

            {canAttachmentUpload ? (
              <form action={uploadTaskAttachmentAction.bind(null, taskId)} className="space-y-3 rounded-2xl border border-[var(--border)] p-4" encType="multipart/form-data">
                <input type="hidden" name="redirectTo" value={`/tasks/${taskId}`} />
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Proof file</span>
                  <input name="file" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="block w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm" required />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Upload note</span>
                  <textarea
                    name="note"
                    maxLength={1000}
                    className="min-h-24 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                    placeholder="Add a short note about this proof"
                  />
                </label>
                <p className="text-xs text-[var(--muted)]">Allowed: JPG, JPEG, PNG, WEBP, PDF. Upload limit follows tenant config.</p>
                <button type="submit" className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium">
                  Upload proof
                </button>
              </form>
            ) : (
              <p className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
                You do not have permission to upload task proofs.
              </p>
            )}

            <div className="mt-4 space-y-3">
              {!taskWorkBundle.canReadAttachments ? (
                <p className="text-sm text-[var(--muted)]">You do not have permission to view task proofs.</p>
              ) : taskWorkBundle.attachments.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No task proofs uploaded yet.</p>
              ) : (
                taskWorkBundle.attachments.map((attachment) => (
                  <article key={attachment.id} className="rounded-2xl border border-[var(--border)] p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{attachment.fileName}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {attachment.attachmentType} · {attachment.mimeType} · {Math.max(1, Math.round(attachment.fileSize / 1024))} KB
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link href={attachment.fileUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs font-medium">
                          Open
                        </Link>
                        {canAttachmentDelete ? (
                          <form action={deleteTaskAttachmentAction.bind(null, taskId, attachment.id)}>
                            <input type="hidden" name="redirectTo" value={`/tasks/${taskId}`} />
                            <button type="submit" className="rounded-xl border border-red-200 px-3 py-2 text-xs font-medium text-red-700">
                              Delete
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      Uploaded by {attachment.uploadedBy?.name?.trim() || attachment.uploadedBy?.email || attachment.uploadedBy?.phone || "Unknown"} on{" "}
                      {formatDateTime(attachment.createdAt)}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">{formatOptional(attachment.note)}</p>
                  </article>
                ))
              )}
            </div>
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
