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
  parentTaskId?: string | null;
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
  parentTaskId,
  task,
  compact = false,
}: TaskFormProps) {
  const shellClassName = compact ? "space-y-4" : "crm-form-shell space-y-5";
  const sectionClassName = compact ? "space-y-4" : "crm-form-section space-y-4";

  return (
    <form action={action} className={shellClassName}>
      <input type="hidden" name="serviceRequestId" value={serviceRequestId} />
      {parentTaskId ? <input type="hidden" name="parentTaskId" value={parentTaskId} /> : null}
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className={sectionClassName}>
        {!compact ? (
          <div>
            <h3 className="crm-form-section-title">{task ? "Update Task" : "New Task"}</h3>
            <p className="crm-form-section-copy">Keep hierarchy, assignee, and work timing aligned with the parent service request.</p>
          </div>
        ) : null}

        <label className="crm-field">
          <span className="crm-field-label">Title</span>
          <input name="title" defaultValue={task?.title ?? ""} className="crm-input" maxLength={240} required />
        </label>

        <label className="crm-field">
          <span className="crm-field-label">Description</span>
          <textarea name="description" defaultValue={task?.description ?? ""} className="crm-textarea" maxLength={1000} />
        </label>

        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field">
            <span className="crm-field-label">Responsible User</span>
          <select
            name="assigneeUserId"
            defaultValue={task?.assigneeUserId ?? ""}
            className="crm-select"
          >
            <option value="">Unassigned</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {userLabel(user)} - {userRoleLabel(user)}
              </option>
            ))}
          </select>
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Status</span>
          <select
            name="status"
            defaultValue={task?.status ?? TaskStatus.YET_TO_START}
            className="crm-select"
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          </label>
        </div>

        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field">
            <span className="crm-field-label">Created At</span>
          <input
            value={task?.createdAt ? toDateTimeLocalInput(task.createdAt) : "Auto-recorded on save"}
            readOnly
            className="crm-input"
          />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Requested Date/Time</span>
          <input
            type="datetime-local"
            name="requestedAt"
            defaultValue={toDateTimeLocalInput(task?.requestedAt)}
            className="crm-input"
          />
          </label>
        </div>

        <div className="crm-form-grid md:grid-cols-2">
          <label className="crm-field">
            <span className="crm-field-label">Start Date</span>
          <input
            type="date"
            name="startDate"
            defaultValue={toDateInput(task?.startDate ?? null)}
            className="crm-input"
          />
          </label>
          <label className="crm-field">
            <span className="crm-field-label">Due Date</span>
          <input
            type="date"
            name="dueDate"
            defaultValue={toDateInput(task?.dueDate ?? null)}
            className="crm-input"
          />
          </label>
        </div>
      </div>

      <button type="submit" className="crm-button w-full sm:w-auto">
        {submitLabel}
      </button>
    </form>
  );
}
