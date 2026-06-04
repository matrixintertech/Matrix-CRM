import { TaskStatus } from "@prisma/client";

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

type TaskFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  serviceRequestId: string;
  redirectTo: string;
  users: TaskUserOption[];
  submitLabel: string;
  task?: {
    title: string;
    description: string | null;
    assigneeUserId: string | null;
    status: TaskStatus;
    requestedAt: Date | null;
    startDate: Date | null;
    dueDate: Date | null;
    createdAt?: Date | null;
  };
  compact?: boolean;
};

const statusOptions: TaskStatus[] = [
  TaskStatus.YET_TO_START,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.COMPLETED,
  TaskStatus.REOPENED,
];

function toDateInput(value: Date | null) {
  if (!value) {
    return "";
  }
  return new Date(value).toISOString().slice(0, 10);
}

function toDateTimeLocalInput(value: Date | null | undefined) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function userLabel(user: TaskUserOption) {
  return user.name?.trim() || user.email || user.phone || user.id;
}

function userRoleLabel(user: TaskUserOption) {
  const role = user.roles[0]?.role;
  if (!role) {
    return "User";
  }
  return `${role.name} (${role.key})`;
}

export function TaskForm({
  action,
  serviceRequestId,
  redirectTo,
  users,
  submitLabel,
  task,
  compact = false,
}: TaskFormProps) {
  return (
    <form action={action} className={compact ? "space-y-2" : "space-y-3 rounded-md border border-[var(--border)] p-3"}>
      <input type="hidden" name="serviceRequestId" value={serviceRequestId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <label className="space-y-1 text-sm">
        <span className="font-medium">Title</span>
        <input
          name="title"
          defaultValue={task?.title ?? ""}
          className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          maxLength={240}
          required
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium">Description</span>
        <textarea
          name="description"
          defaultValue={task?.description ?? ""}
          className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
          maxLength={1000}
        />
      </label>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Responsible User</span>
          <select
            name="assigneeUserId"
            defaultValue={task?.assigneeUserId ?? ""}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {userLabel(user)} - {userRoleLabel(user)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            name="status"
            defaultValue={task?.status ?? TaskStatus.YET_TO_START}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Created At</span>
          <input
            value={task?.createdAt ? toDateTimeLocalInput(task.createdAt) : "Auto-recorded on save"}
            readOnly
            className="h-9 w-full rounded-md border border-[var(--border)] bg-slate-50 px-3 text-slate-600"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Requested Date/Time</span>
          <input
            type="datetime-local"
            name="requestedAt"
            defaultValue={toDateTimeLocalInput(task?.requestedAt)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Start Date</span>
          <input
            type="date"
            name="startDate"
            defaultValue={toDateInput(task?.startDate ?? null)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Due Date</span>
          <input
            type="date"
            name="dueDate"
            defaultValue={toDateInput(task?.dueDate ?? null)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
      </div>

      <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
        {submitLabel}
      </button>
    </form>
  );
}
