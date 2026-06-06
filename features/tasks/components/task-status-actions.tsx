import { TaskStatus } from "@prisma/client";

import { updateTaskStatusAction } from "@/features/tasks/actions/task.actions";

const statusOptions: TaskStatus[] = [
  TaskStatus.YET_TO_START,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.COMPLETED,
  TaskStatus.REOPENED,
];

type TaskStatusActionsProps = {
  taskId: string;
  currentStatus: TaskStatus;
  redirectTo: string;
};

export function TaskStatusActions({ taskId, currentStatus, redirectTo }: TaskStatusActionsProps) {
  return (
    <form action={updateTaskStatusAction.bind(null, taskId)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select
        name="status"
        defaultValue={currentStatus}
        className="h-10 rounded-xl border border-[var(--border)] px-3 text-sm"
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button type="submit" className="min-h-10 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium">
        Save
      </button>
    </form>
  );
}
