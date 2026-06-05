import Link from "next/link";
import { TaskStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import { deleteTaskAction, updateTaskAction } from "@/features/tasks/actions/task.actions";
import { TaskForm } from "@/features/tasks/components/task-form";
import { TaskStatusActions } from "@/features/tasks/components/task-status-actions";
import { formatDateTime } from "@/lib/utils/format";

type TaskRow = {
  id: string;
  taskNumber: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeUserId: string | null;
  requestedAt: Date | null;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  parentTaskId: string | null;
  assignee: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  createdBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  assignedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  hierarchyDepth: number;
  assignmentChain: string[];
  childTaskCount: number;
  latestChildStatus: TaskStatus | null;
  isSubTask: boolean;
  parentTaskSummary: {
    id: string;
    taskNumber: string;
    title: string;
  } | null;
  serviceRequestSummary: {
    id: string;
    serviceNumber: string;
    title: string;
  };
  createdAt: Date;
  updatedAt: Date;
};

type TaskUserOption = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  roles: {
    role: {
      key: string;
      name: string;
    };
  }[];
};

type TasksTableProps = {
  serviceRequestId: string;
  redirectTo: string;
  tasks: TaskRow[];
  users: TaskUserOption[];
  canUpdate: boolean;
  canDelete: boolean;
  canUpdateStatus: boolean;
  showServiceRequest?: boolean;
};

function userLabel(user: { name: string | null; email: string | null; phone: string | null } | null) {
  if (!user) {
    return "-";
  }
  return user.name?.trim() || user.email || user.phone || "-";
}

export function TasksTable({
  serviceRequestId,
  redirectTo,
  tasks,
  users,
  canUpdate,
  canDelete,
  canUpdateStatus,
  showServiceRequest = false,
}: TasksTableProps) {
  if (tasks.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No work items yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-[var(--border)]">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Work Item</th>
              {showServiceRequest ? <th className="px-3 py-2">Service Request</th> : null}
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Responsible</th>
              <th className="px-3 py-2">Assigned By</th>
              <th className="px-3 py-2">Created At</th>
              <th className="px-3 py-2">Requested At</th>
              <th className="px-3 py-2">Due Date</th>
              <th className="px-3 py-2">Hierarchy</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">
                  <div style={{ paddingLeft: `${task.hierarchyDepth * 16}px` }}>
                    <p className="font-medium">
                      <Link href={`/tasks/${task.id}`} className="text-[var(--primary)] underline-offset-2 hover:underline">
                        {task.title}
                      </Link>
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {task.taskNumber}
                      {task.parentTaskSummary ? ` | Parent: ${task.parentTaskSummary.taskNumber}` : ""}
                    </p>
                    <p className="text-xs text-[var(--muted)]">{task.description?.trim() ? task.description : "-"}</p>
                  </div>
                </td>
                {showServiceRequest ? (
                  <td className="px-3 py-2">
                    <Link href={`/service-requests/${task.serviceRequestSummary.id}`} className="text-[var(--primary)] underline-offset-2 hover:underline">
                      {task.serviceRequestSummary.serviceNumber}
                    </Link>
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  <div className="space-y-1">
                    <StatusBadge value={task.status} />
                    {task.latestChildStatus ? <p className="text-xs text-[var(--muted)]">Latest child: {task.latestChildStatus}</p> : null}
                  </div>
                </td>
                <td className="px-3 py-2">{userLabel(task.assignee)}</td>
                <td className="px-3 py-2">{userLabel(task.assignedBy)}</td>
                <td className="px-3 py-2">{formatDateTime(task.createdAt)}</td>
                <td className="px-3 py-2">{formatDateTime(task.requestedAt)}</td>
                <td className="px-3 py-2">{formatDateTime(task.dueDate)}</td>
                <td className="px-3 py-2">
                  <div className="space-y-1 text-xs text-[var(--muted)]">
                    <p>Level {task.hierarchyDepth}{task.parentTaskSummary ? "" : " (top-level)"}</p>
                    <p>{task.childTaskCount} child task(s)</p>
                    {task.parentTaskSummary ? (
                      <p>
                        Parent:{" "}
                        <Link href={`/tasks/${task.parentTaskSummary.id}`} className="text-[var(--primary)] underline-offset-2 hover:underline">
                          {task.parentTaskSummary.taskNumber}
                        </Link>
                      </p>
                    ) : null}
                    {task.assignmentChain.length > 0 ? <p>{task.assignmentChain.join(" | ")}</p> : null}
                  </div>
                </td>
                <td className="px-3 py-2">{formatDateTime(task.updatedAt)}</td>
                <td className="px-3 py-2">
                  <div className="space-y-2">
                    <Link href={`/tasks/${task.id}`} className="block rounded-md border border-[var(--border)] px-2 py-1 text-center text-xs">
                      View
                    </Link>
                    {canUpdateStatus ? (
                      <TaskStatusActions taskId={task.id} currentStatus={task.status} redirectTo={redirectTo} />
                    ) : null}
                    {canDelete ? (
                      <form action={deleteTaskAction.bind(null, task.id)}>
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <button type="submit" className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">
                          Delete
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canUpdate ? (
        <div className="space-y-2">
          {tasks.map((task) => (
            <details key={`${task.id}-edit`} className="rounded-md border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--primary)]">Edit {task.taskNumber}</summary>
              <div className="mt-3">
                <TaskForm
                  action={updateTaskAction.bind(null, task.id)}
                  serviceRequestId={serviceRequestId}
                  redirectTo={redirectTo}
                  users={users}
                  submitLabel="Update work item"
                  compact
                  task={{
                    title: task.title,
                    description: task.description,
                    assigneeUserId: task.assigneeUserId,
                    status: task.status,
                    requestedAt: task.requestedAt,
                    startDate: task.startDate,
                    dueDate: task.dueDate,
                    createdAt: task.createdAt,
                  }}
                />
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
