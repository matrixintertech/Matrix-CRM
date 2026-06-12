import type { ReactNode } from "react";

import { TaskStatus } from "@prisma/client";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { createTaskAction, deleteTaskAction } from "@/features/tasks/actions/task.actions";
import {
  listTaskFilterUsers,
  listTaskResponsibilityUsers,
  listTasks,
  listTaskServiceRequestOptions,
} from "@/features/tasks/services/task.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type TasksPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type TasksResult = Awaited<ReturnType<typeof listTasks>>;
type TaskRow = TasksResult["tasks"][number];

type DashboardTaskStatus = "todo" | "in_progress" | "completed" | "cancelled" | "overdue";
type DerivedPriority = "high" | "medium" | "low";
type DueRange = "today" | "tomorrow" | "this_week" | "overdue";
type TaskScopeFilter = "all" | "my" | "delegated" | "downline" | "company";

const pageSize = 10;
const scopeOptions: Array<{ value: TaskScopeFilter; label: string; description: string }> = [
  { value: "all", label: "All Tasks", description: "Full tenant task stream" },
  { value: "my", label: "My Tasks", description: "Directly assigned to you" },
  { value: "delegated", label: "Delegated", description: "Created or delegated by you" },
  { value: "downline", label: "Downline", description: "Visible through hierarchy scope" },
  { value: "company", label: "Company", description: "Company-wide operational view" },
];

const createStatusOptions: TaskStatus[] = [
  TaskStatus.YET_TO_START,
  TaskStatus.IN_PROGRESS,
  TaskStatus.BLOCKED,
  TaskStatus.COMPLETED,
  TaskStatus.REOPENED,
];

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

function toPriority(value?: string): DerivedPriority | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function toDueRange(value?: string): DueRange | undefined {
  return value === "today" || value === "tomorrow" || value === "this_week" || value === "overdue" ? value : undefined;
}

function buildTasksHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

function getPageTokens(page: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: Array<number | string> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    tokens.push("left-gap");
  }

  for (let current = start; current <= end; current += 1) {
    tokens.push(current);
  }

  if (end < totalPages - 1) {
    tokens.push("right-gap");
  }

  tokens.push(totalPages);
  return tokens;
}

function buildDistributionGradient(entries: Array<{ count: number; color: string }>) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0) || 1;
  let cursor = 0;
  const slices = entries.map((entry) => {
    const start = cursor;
    cursor += (entry.count / total) * 360;
    return `${entry.color} ${start}deg ${cursor}deg`;
  });
  return `conic-gradient(${slices.join(", ")})`;
}

function isTaskOverdue(task: TaskRow, referenceTime: number) {
  if (!task.dueDate) {
    return false;
  }
  if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.BLOCKED) {
    return false;
  }
  return task.dueDate.getTime() < referenceTime;
}

function getTaskDashboardStatus(task: TaskRow, referenceTime: number): DashboardTaskStatus {
  if (task.status === TaskStatus.COMPLETED) {
    return "completed";
  }
  if (task.status === TaskStatus.BLOCKED) {
    return "cancelled";
  }
  if (isTaskOverdue(task, referenceTime)) {
    return "overdue";
  }
  if (task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.REOPENED) {
    return "in_progress";
  }
  return "todo";
}

function getTaskPriority(task: TaskRow, referenceTime: number): DerivedPriority {
  if (isTaskOverdue(task, referenceTime)) {
    return "high";
  }

  if (!task.dueDate) {
    return task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.BLOCKED || task.status === TaskStatus.REOPENED ? "medium" : "low";
  }

  const diffDays = (task.dueDate.getTime() - referenceTime) / (1000 * 60 * 60 * 24);
  if (diffDays <= 1) {
    return "high";
  }
  if (diffDays <= 3 || task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.BLOCKED || task.status === TaskStatus.REOPENED) {
    return "medium";
  }
  return "low";
}

function matchesDueRange(task: TaskRow, dueRange: DueRange | undefined, referenceTime: number) {
  if (!dueRange) {
    return true;
  }

  if (dueRange === "overdue") {
    return isTaskOverdue(task, referenceTime);
  }

  if (!task.dueDate) {
    return false;
  }

  const now = new Date(referenceTime);
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);

  const endToday = new Date(startToday);
  endToday.setHours(23, 59, 59, 999);

  const startTomorrow = new Date(startToday);
  startTomorrow.setDate(startTomorrow.getDate() + 1);

  const endTomorrow = new Date(startTomorrow);
  endTomorrow.setHours(23, 59, 59, 999);

  const endWeek = new Date(startToday);
  endWeek.setDate(endWeek.getDate() + 7);
  endWeek.setHours(23, 59, 59, 999);

  if (dueRange === "today") {
    return task.dueDate >= startToday && task.dueDate <= endToday;
  }
  if (dueRange === "tomorrow") {
    return task.dueDate >= startTomorrow && task.dueDate <= endTomorrow;
  }
  return task.dueDate >= startToday && task.dueDate <= endWeek;
}

function formatShortDate(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatShortDateTime(value: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatRelativeUpdate(value: Date | null) {
  if (!value) {
    return "No recent updates";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Last updated: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last updated: ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Last updated: ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatDueChip(value: Date | null, referenceTime: number) {
  if (!value) {
    return "No due date";
  }

  const today = new Date(referenceTime);
  today.setHours(0, 0, 0, 0);

  const target = new Date(value);
  target.setHours(0, 0, 0, 0);

  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today, ${formatShortDateTime(value).split(", ").slice(-1)[0]}`;
  }
  if (diffDays === 1) {
    return `Tomorrow, ${formatShortDateTime(value).split(", ").slice(-1)[0]}`;
  }
  if (diffDays > 1) {
    return `In ${diffDays} days`;
  }

  const daysOverdue = Math.abs(diffDays);
  return `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`;
}

function getStatusMeta(status: DashboardTaskStatus) {
  if (status === "todo") {
    return {
      label: "To Do",
      tone: "bg-[#edf3ff] text-[#3f66ff]",
      color: "#3f66ff",
    };
  }
  if (status === "in_progress") {
    return {
      label: "In Progress",
      tone: "bg-[#fff4e5] text-[#e7881d]",
      color: "#f5a623",
    };
  }
  if (status === "completed") {
    return {
      label: "Completed",
      tone: "bg-[#eaf8ef] text-[#1d9d57]",
      color: "#2fc76d",
    };
  }
  if (status === "cancelled") {
    return {
      label: "Cancelled",
      tone: "bg-[#eef2f7] text-[#7a8cac]",
      color: "#8fa0bc",
    };
  }
  return {
    label: "Overdue",
    tone: "bg-[#fff1f1] text-[#ff4f5e]",
    color: "#ff4f5e",
  };
}

function getPriorityMeta(priority: DerivedPriority) {
  if (priority === "high") {
    return {
      label: "High",
      tone: "bg-[#fff1f1] text-[#ff4f5e]",
      color: "#ff4f5e",
    };
  }
  if (priority === "medium") {
    return {
      label: "Medium",
      tone: "bg-[#fff4e5] text-[#e7881d]",
      color: "#f5a623",
    };
  }
  return {
    label: "Low",
    tone: "bg-[#eaf8ef] text-[#1d9d57]",
    color: "#2fc76d",
  };
}

function getAvatarTone(value: string) {
  const tones = [
    "from-[#5b5df8] to-[#4137d8]",
    "from-[#1f9bf0] to-[#1a77f2]",
    "from-[#11b981] to-[#149c67]",
    "from-[#f97316] to-[#ea580c]",
    "from-[#8b5cf6] to-[#6d28d9]",
  ];
  const total = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function getInitials(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getUserDisplay(task: TaskRow["assignee"]) {
  if (!task) {
    return {
      name: "Unassigned",
      subtitle: "No owner",
      initials: "NA",
    };
  }

  const label = task.name?.trim() || task.email || task.phone || "Unassigned";
  return {
    name: label,
    subtitle: task.email || task.phone || "Assigned task",
    initials: getInitials(label),
  };
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  trend,
  trendTone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  subtitle: string;
  trend: string;
  trendTone: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#e8edf7] bg-white/95 p-5 shadow-[0_16px_40px_rgba(23,52,110,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/70 bg-gradient-to-br from-[#f8f9ff] to-[#eef3ff] text-[#315cff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {icon}
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${trendTone}`}>{trend}</span>
      </div>
      <p className="mt-4 text-sm font-medium text-[#63759b]">{title}</p>
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value.toLocaleString("en-IN")}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function RowActionIcon({ kind }: { kind: "view" | "edit" | "delete" | "more" }) {
  if (kind === "view") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
      </svg>
    );
  }

  if (kind === "delete") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M5 7h14" />
        <path d="M9 7V5h6v2" />
        <path d="M7 7l1 12h8l1-12" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function TaskPagination({
  page,
  totalPages,
  currentFilters,
}: {
  page: number;
  totalPages: number;
  currentFilters: Record<string, string | number | undefined>;
}) {
  const visiblePages = getPageTokens(page, totalPages);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <PrefetchLink href={buildTasksHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildTasksHref({ ...currentFilters, page: token })}
            className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
              token === page
                ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]"
                : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
            }`}
          >
            {token}
          </PrefetchLink>
        ) : (
          <span key={token} className="px-1 text-sm text-[#8ea0bf]">
            ...
          </span>
        )
      )}
      {page < totalPages ? (
        <PrefetchLink href={buildTasksHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const session = await requirePermission("tasks.read");
  const [params, canCreate, canUpdate, canDelete, filterUsers] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "tasks.create"),
    hasPermission(session, "tasks.update"),
    hasPermission(session, "tasks.delete"),
    listTaskFilterUsers(session),
  ]);
  const [assignableUsers, serviceRequests] = await Promise.all([
    canCreate ? listTaskResponsibilityUsers(session, session.user.servicePartnerId) : Promise.resolve([]),
    canCreate ? listTaskServiceRequestOptions(session) : Promise.resolve([]),
  ]);

  const q = getStringParam(params, "q");
  const rawStatus = getStringParam(params, "status");
  const status = Object.values(TaskStatus).find((value) => value === rawStatus);
  const assigneeUserId = getStringParam(params, "assigneeUserId");
  const assignedByUserId = getStringParam(params, "assignedByUserId");
  const serviceRequestId = getStringParam(params, "serviceRequestId");
  const priority = toPriority(getStringParam(params, "priority"));
  const dueRange = toDueRange(getStringParam(params, "dueRange"));
  const page = Math.max(getNumberParam(params, "page") ?? 1, 1);
  const scopeParam = getStringParam(params, "scope");
  const scope: TaskScopeFilter =
    scopeParam === "my" || scopeParam === "delegated" || scopeParam === "downline" || scopeParam === "company" ? scopeParam : "all";
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listTasks(session, {
    q,
    status,
    assigneeUserId,
    assignedByUserId,
    serviceRequestId,
    scope,
    overdue: rawStatus === "overdue" || dueRange === "overdue" ? true : undefined,
  });

  const referenceTime = Date.now();
  const filteredTasks = result.tasks.filter((task) => {
    if (rawStatus === "overdue" && !isTaskOverdue(task, referenceTime)) {
      return false;
    }
    if (priority && getTaskPriority(task, referenceTime) !== priority) {
      return false;
    }
    if (!matchesDueRange(task, dueRange, referenceTime)) {
      return false;
    }
    return true;
  });

  const totals = filteredTasks.reduce(
    (acc, task) => {
      const dashboardStatus = getTaskDashboardStatus(task, referenceTime);
      const derivedPriority = getTaskPriority(task, referenceTime);

      acc.total += 1;
      acc.status[dashboardStatus] += 1;
      acc.priority[derivedPriority] += 1;
      return acc;
    },
    {
      total: 0,
      status: {
        todo: 0,
        in_progress: 0,
        completed: 0,
        cancelled: 0,
        overdue: 0,
      } as Record<DashboardTaskStatus, number>,
      priority: {
        high: 0,
        medium: 0,
        low: 0,
      } as Record<DerivedPriority, number>,
    }
  );

  const statusBreakdown = (["todo", "in_progress", "completed", "cancelled", "overdue"] as DashboardTaskStatus[]).map((key) => ({
    key,
    count: totals.status[key],
    ...getStatusMeta(key),
  }));
  const priorityBreakdown = (["high", "medium", "low"] as DerivedPriority[]).map((key) => ({
    key,
    count: totals.priority[key],
    ...getPriorityMeta(key),
  }));

  const latestUpdatedAt = filteredTasks.reduce<Date | null>((latest, task) => {
    if (!latest || task.updatedAt > latest) {
      return task.updatedAt;
    }
    return latest;
  }, null);

  const upcomingTasks = filteredTasks
    .filter((task) => task.dueDate && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.BLOCKED)
    .sort((left, right) => (left.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 5);

  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedTasks = filteredTasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const showingFrom = filteredTasks.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const showingTo = Math.min(currentPage * pageSize, filteredTasks.length);

  const currentFilters = {
    q,
    status: rawStatus ?? undefined,
    assigneeUserId,
    assignedByUserId,
    serviceRequestId,
    priority,
    dueRange,
    scope: scope !== "all" ? scope : undefined,
  };

  const statusTotal = statusBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const priorityTotal = priorityBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
  const statusGradient = buildDistributionGradient(statusBreakdown);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Tasks</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Manage and track all tasks assigned across the platform.
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(latestUpdatedAt)}</p>
          {canCreate ? (
            <PrefetchLink href="#task-create-panel" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>New Task</span>
            </PrefetchLink>
          ) : null}
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="3" width="14" height="18" rx="2.5" />
              <path d="M8 8h8M8 12h8M8 16h6" />
            </svg>
          }
          title="Total Tasks"
          value={totals.total}
          subtitle="All time"
          trend="100%"
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="7" y="4" width="10" height="16" rx="2.5" />
              <path d="M10 8h4M10 12h4" />
              <path d="M11 16h2" />
            </svg>
          }
          title="To Do"
          value={totals.status.todo}
          subtitle={`${((totals.status.todo / Math.max(totals.total, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((totals.status.todo / Math.max(totals.total, 1)) * 100)}%`}
          trendTone="bg-[#edf3ff] text-[#3f66ff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="m8 6 8 6-8 6V6Z" />
            </svg>
          }
          title="In Progress"
          value={totals.status.in_progress}
          subtitle={`${((totals.status.in_progress / Math.max(totals.total, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((totals.status.in_progress / Math.max(totals.total, 1)) * 100)}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="m8.5 12 2.3 2.3 4.7-5.1" />
            </svg>
          }
          title="Completed"
          value={totals.status.completed}
          subtitle={`${((totals.status.completed / Math.max(totals.total, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((totals.status.completed / Math.max(totals.total, 1)) * 100)}%`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </svg>
          }
          title="Overdue"
          value={totals.status.overdue}
          subtitle="Requires attention"
          trend={`${Math.round((totals.status.overdue / Math.max(totals.total, 1)) * 100)}%`}
          trendTone="bg-[#fff1f1] text-[#ff4f5e]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M8 7h8" />
              <path d="M6 10h12l-1 9H7l-1-9Z" />
              <path d="M9 10V6a3 3 0 0 1 6 0v4" />
            </svg>
          }
          title="Cancelled"
          value={totals.status.cancelled}
          subtitle={`${((totals.status.cancelled / Math.max(totals.total, 1)) * 100).toFixed(1)}% of total`}
          trend={`${Math.round((totals.status.cancelled / Math.max(totals.total, 1)) * 100)}%`}
          trendTone="bg-[#eef2f7] text-[#7a8cac]"
        />
      </div>

      <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-[-0.03em] text-[#122449]">Task Scope</h2>
            <p className="mt-1 text-sm text-[#7082a6]">Switch between direct assignments, delegated work, and broader hierarchy visibility.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {scopeOptions.map((option) => {
              const isActive = scope === option.value;

              return (
                <PrefetchLink
                  key={option.value}
                  href={buildTasksHref({
                    ...currentFilters,
                    scope: option.value === "all" ? undefined : option.value,
                    page: 1,
                  })}
                  className={`inline-flex min-h-12 min-w-[148px] flex-col items-start justify-center rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff] shadow-[0_12px_24px_rgba(49,92,255,0.12)]"
                      : "border-[#dfe6f2] bg-[#fbfcff] text-[#4f6388] hover:border-[#d5deef] hover:bg-white"
                  }`}
                >
                  <span className="text-sm font-semibold">{option.label}</span>
                  <span className={`mt-1 text-xs ${isActive ? "text-[#5a73ff]" : "text-[#8a9ab8]"}`}>{option.description}</span>
                </PrefetchLink>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
        <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_1fr_1fr_1fr_1fr_auto] xl:items-end">
          <input type="hidden" name="scope" value={scope} />
          {assignedByUserId ? <input type="hidden" name="assignedByUserId" value={assignedByUserId} /> : null}
          {serviceRequestId ? <input type="hidden" name="serviceRequestId" value={serviceRequestId} /> : null}

          <label className="block">
            <span className="relative block">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search tasks by title, ID, assignee..."
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
            <select
              name="status"
              defaultValue={rawStatus ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Status</option>
              <option value={TaskStatus.YET_TO_START}>To Do</option>
              <option value={TaskStatus.IN_PROGRESS}>In Progress</option>
              <option value={TaskStatus.COMPLETED}>Completed</option>
              <option value={TaskStatus.BLOCKED}>Cancelled</option>
              <option value="overdue">Overdue</option>
              <option value={TaskStatus.REOPENED}>Reopened</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Priority</span>
            <select
              name="priority"
              defaultValue={priority ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Priority</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Assignees</span>
            <select
              name="assigneeUserId"
              defaultValue={assigneeUserId ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Assignees</option>
              {filterUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name?.trim() || user.email || user.phone || user.id}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Due Dates</span>
            <select
              name="dueRange"
              defaultValue={dueRange ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Due Dates</option>
              <option value="today">Today</option>
              <option value="tomorrow">Tomorrow</option>
              <option value="this_week">This Week</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff] transition hover:bg-white">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
              </svg>
              <span>Apply Filters</span>
            </button>
            <PrefetchLink href={buildTasksHref({ scope: scope !== "all" ? scope : undefined })} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
              </svg>
              <span>Reset</span>
            </PrefetchLink>
          </div>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_360px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          {filteredTasks.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No tasks found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi task record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Task ID</th>
                      <th className="px-4 py-4">Title</th>
                      <th className="px-4 py-4">Assigned To</th>
                      <th className="px-4 py-4">Related To</th>
                      <th className="px-4 py-4">Priority</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-4 py-4">Due Date</th>
                      <th className="px-4 py-4">Created At</th>
                      <th className="px-5 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {pagedTasks.map((task) => {
                      const taskStatus = getTaskDashboardStatus(task, referenceTime);
                      const statusMeta = getStatusMeta(taskStatus);
                      const priorityMeta = getPriorityMeta(getTaskPriority(task, referenceTime));
                      const assignee = getUserDisplay(task.assignee);

                      return (
                        <tr key={task.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{task.taskNumber}</td>
                          <td className="px-4 py-4">
                            <div>
                              <PrefetchLink href={`/tasks/${task.id}`} className="text-sm font-semibold text-[#122449] hover:text-[#315cff]">
                                {task.title}
                              </PrefetchLink>
                              <p className="mt-1 text-xs text-[#8092b2]">
                                {task.parentTaskSummary ? `Parent: ${task.parentTaskSummary.taskNumber}` : task.description?.trim() || "Top-level task"}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(assignee.name)} text-xs font-semibold text-white`}>
                                {assignee.initials}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[#173260]">{assignee.name}</p>
                                <p className="mt-1 truncate text-xs text-[#8092b2]">{assignee.subtitle}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <PrefetchLink href={`/service-requests/${task.serviceRequestSummary.id}`} className="block text-sm font-medium text-[#173260] hover:text-[#315cff]">
                              {task.serviceRequestSummary.serviceNumber}
                            </PrefetchLink>
                            <p className="mt-1 text-xs text-[#8092b2]">{task.serviceRequestSummary.title}</p>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${priorityMeta.tone}`}>{priorityMeta.label}</span>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                          </td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDateTime(task.dueDate)}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDateTime(task.createdAt)}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={`/tasks/${task.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${task.taskNumber}`}>
                                <RowActionIcon kind="view" />
                              </PrefetchLink>
                              {canUpdate ? (
                                <PrefetchLink href={`/tasks/${task.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`Edit ${task.taskNumber}`}>
                                  <RowActionIcon kind="edit" />
                                </PrefetchLink>
                              ) : null}
                              {canDelete ? (
                                <form action={deleteTaskAction.bind(null, task.id)}>
                                  <input type="hidden" name="redirectTo" value="/tasks" />
                                  <button type="submit" className="grid h-9 w-9 place-items-center rounded-xl border border-[#ffe1e1] bg-[#fff8f8] text-[#ff5a5a] transition hover:bg-[#fff0f0]" aria-label={`Delete ${task.taskNumber}`}>
                                    <RowActionIcon kind="delete" />
                                  </button>
                                </form>
                              ) : (
                                <PrefetchLink href={`/tasks/${task.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#6f82a4] transition hover:bg-[#f6f8ff]" aria-label={`More ${task.taskNumber}`}>
                                  <RowActionIcon kind="more" />
                                </PrefetchLink>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 p-4 lg:hidden">
                {pagedTasks.map((task) => {
                  const taskStatus = getTaskDashboardStatus(task, referenceTime);
                  const statusMeta = getStatusMeta(taskStatus);
                  const priorityMeta = getPriorityMeta(getTaskPriority(task, referenceTime));
                  const assignee = getUserDisplay(task.assignee);

                  return (
                    <article key={task.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{task.title}</p>
                          <p className="mt-1 truncate text-xs text-[#8092b2]">{task.taskNumber}</p>
                        </div>
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Assigned To</p>
                          <p className="mt-1 text-sm text-[#16315f]">{assignee.name}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Priority</p>
                          <p className="mt-1 text-sm text-[#16315f]">{priorityMeta.label}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Related To</p>
                          <p className="mt-1 text-sm text-[#16315f]">{task.serviceRequestSummary.serviceNumber}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Due</p>
                          <p className="mt-1 text-sm text-[#16315f]">{formatShortDate(task.dueDate)}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <PrefetchLink href={`/tasks/${task.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                          <RowActionIcon kind="view" />
                          <span>View</span>
                        </PrefetchLink>
                        {canUpdate ? (
                          <PrefetchLink href={`/tasks/${task.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                            <RowActionIcon kind="edit" />
                            <span>Edit</span>
                          </PrefetchLink>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {filteredTasks.length} tasks
                </p>

                <TaskPagination page={currentPage} totalPages={totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Tasks by Status</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: statusGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[2rem] font-semibold leading-none text-[#11244a]">{totals.total}</p>
                      <p className="mt-2 text-sm font-medium text-[#6f82a4]">Total</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {statusBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="text-[#173260]">{entry.label}</span>
                    </div>
                    <span className="text-[#6f82a4]">
                      {entry.count} ({Math.round((entry.count / statusTotal) * 100)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Tasks by Priority</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {priorityBreakdown.map((entry) => (
                <div key={entry.key}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-3">
                      <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span className="font-medium text-[#173260]">{entry.label}</span>
                    </div>
                    <span className="text-[#6f82a4]">
                      {entry.count} ({Math.round((entry.count / priorityTotal) * 100)}%)
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#eef2fb]">
                    <div className="h-2 rounded-full" style={{ width: `${Math.max((entry.count / priorityTotal) * 100, 6)}%`, backgroundColor: entry.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Upcoming Due Tasks</h2>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {upcomingTasks.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#7486a8]">No upcoming due tasks.</p>
              ) : (
                upcomingTasks.map((task) => (
                  <PrefetchLink key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                    <div className="grid h-10 w-10 place-items-center rounded-full bg-[#edf3ff] text-[#315cff]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                        <rect x="6" y="4" width="12" height="16" rx="2.5" />
                        <path d="M9 8h6M9 12h6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{task.title}</p>
                      <p className="mt-1 truncate text-xs text-[#8092b2]">{task.taskNumber}</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${isTaskOverdue(task, referenceTime) ? "bg-[#fff1f1] text-[#ff4f5e]" : "bg-[#edf3ff] text-[#3f66ff]"}`}>
                      {formatDueChip(task.dueDate, referenceTime)}
                    </span>
                  </PrefetchLink>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {canCreate && serviceRequests.length > 0 ? (
        <details id="task-create-panel" className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <summary className="cursor-pointer list-none px-5 py-4 text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449] [&::-webkit-details-marker]:hidden">
            Create Task
          </summary>
          <div className="border-t border-[#edf2fb] px-5 py-5">
            <form action={createTaskAction} className="grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="redirectTo" value="/tasks" />

              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Service Request</span>
                <select
                  name="serviceRequestId"
                  required
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">Select service request</option>
                  {serviceRequests.map((serviceRequest) => (
                    <option key={serviceRequest.id} value={serviceRequest.id}>
                      {serviceRequest.serviceNumber} - {serviceRequest.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Title</span>
                <input
                  name="title"
                  required
                  maxLength={240}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Description</span>
                <textarea
                  name="description"
                  maxLength={1000}
                  className="min-h-28 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 py-3 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Responsible User</span>
                <select
                  name="assigneeUserId"
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">Unassigned</option>
                  {assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name?.trim() || user.email || user.phone || user.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
                <select
                  name="status"
                  defaultValue={TaskStatus.YET_TO_START}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  {createStatusOptions.map((statusOption) => (
                    <option key={statusOption} value={statusOption}>
                      {statusOption}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Requested Date / Time</span>
                <input
                  type="datetime-local"
                  name="requestedAt"
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Start Date</span>
                <input
                  type="date"
                  name="startDate"
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block lg:col-span-2">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Due Date</span>
                <input
                  type="date"
                  name="dueDate"
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <div className="lg:col-span-2">
                <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10 4v12M4 10h12" />
                  </svg>
                  <span>Create Task</span>
                </button>
              </div>
            </form>
          </div>
        </details>
      ) : null}
    </section>
  );
}
