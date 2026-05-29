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
    <form action={updateTaskStatusAction.bind(null, taskId)} className="flex items-center gap-2">
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <select
        name="status"
        defaultValue={currentStatus}
        className="h-8 rounded-md border border-[var(--border)] px-2 text-xs"
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <button type="submit" className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium">
        Save
      </button>
    </form>
  );
}
