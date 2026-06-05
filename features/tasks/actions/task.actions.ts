"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createTaskRemarkSchema,
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from "@/features/tasks/validations";
import {
  createTask,
  createTaskRemark,
  getTaskById,
  softDeleteTask,
  updateTask,
  updateTaskStatus,
} from "@/features/tasks/services/task.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requireAnyPermission, requirePermission } from "@/lib/auth/rbac";
import { notifyTaskAssigned, notifyTaskStatusChanged, notifyTaskUpdated } from "@/lib/notifications/notification.service";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

function revalidateServiceRequestTaskPaths(serviceRequestId: string) {
  revalidatePath("/tasks");
  revalidatePath("/service-requests");
  revalidatePath(`/service-requests/${serviceRequestId}`);
}

function revalidateTaskDetailPath(taskId: string) {
  revalidatePath(`/tasks/${taskId}`);
}

export async function createTaskAction(formData: FormData) {
  const session = await requireAnyPermission(["tasks.create", "tasks.delegate"]);
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const parsed = createTaskSchema.safeParse({
    serviceRequestId: getFormString(formData, "serviceRequestId"),
    parentTaskId: getFormString(formData, "parentTaskId"),
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    assigneeUserId: getFormString(formData, "assigneeUserId"),
    status: getFormString(formData, "status"),
    requestedAt: getFormString(formData, "requestedAt"),
    startDate: getFormString(formData, "startDate"),
    dueDate: getFormString(formData, "dueDate"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-validation"));
  }

  try {
    const created = await createTask(session, parsed.data);
    await logActivity({
      action: parsed.data.parentTaskId ? "task.delegate" : "task.create",
      module: "tasks",
      entityType: "TASK",
      entityId: created.id,
      message: parsed.data.parentTaskId ? "Sub-task delegated" : "Task created",
      metadata: {
        taskNumber: created.taskNumber,
        serviceRequestId: created.serviceRequestId,
        parentTaskId: created.parentTaskId,
        assigneeUserId: created.assigneeUserId,
        assignedByUserId: created.assignedByUserId,
      },
      servicePartnerId: created.servicePartnerId,
    });
    try {
      await notifyTaskAssigned(created.id, session.user.id);
    } catch (notificationError) {
      console.error("Task assignment notification failed", {
        taskId: created.id,
        reason: notificationError instanceof Error ? notificationError.message.slice(0, 200) : "unknown",
      });
    }
    revalidateServiceRequestTaskPaths(created.serviceRequestId);
    revalidateTaskDetailPath(created.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-created`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("delegate") || lower.includes("lower-level") || lower.includes("parent task")) {
        redirect(withErrorCode(redirectTo, "task-delegation-blocked"));
      }
      if (lower.includes("assignee") || lower.includes("tenant")) {
        redirect(withErrorCode(redirectTo, "task-assignee-mismatch"));
      }
      if (lower.includes("service request not found")) {
        redirect(withErrorCode(redirectTo, "task-service-request-not-found"));
      }
    }
    throw error;
  }
}

export async function updateTaskAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const parsed = updateTaskSchema.safeParse({
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    assigneeUserId: getFormString(formData, "assigneeUserId"),
    status: getFormString(formData, "status"),
    requestedAt: getFormString(formData, "requestedAt"),
    startDate: getFormString(formData, "startDate"),
    dueDate: getFormString(formData, "dueDate"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-validation"));
  }

  try {
    const before = await getTaskById(session, taskId);
    const updated = await updateTask(session, taskId, parsed.data);
    const assigneeChanged = before?.assigneeUserId !== updated.assigneeUserId;
    await logActivity({
      action: assigneeChanged ? "task.assign" : "task.update",
      module: "tasks",
      entityType: "TASK",
      entityId: updated.id,
      message: assigneeChanged ? "Task assignment updated" : "Task updated",
      metadata: {
        previousAssigneeUserId: before?.assigneeUserId ?? null,
        status: updated.status,
        assigneeUserId: updated.assigneeUserId,
        parentTaskId: updated.parentTaskId,
        assignedByUserId: updated.assignedByUserId,
      },
      servicePartnerId: updated.servicePartnerId,
    });
    try {
      if (assigneeChanged) {
        await notifyTaskAssigned(updated.id, session.user.id);
      } else {
        await notifyTaskUpdated(updated.id, session.user.id);
      }
    } catch (notificationError) {
      console.error("Task update notification failed", {
        taskId: updated.id,
        reason: notificationError instanceof Error ? notificationError.message.slice(0, 200) : "unknown",
      });
    }
    revalidateServiceRequestTaskPaths(updated.serviceRequestId);
    revalidateTaskDetailPath(updated.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-updated`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("delegate") || lower.includes("lower-level")) {
        redirect(withErrorCode(redirectTo, "task-delegation-blocked"));
      }
      if (lower.includes("assignee") || lower.includes("tenant")) {
        redirect(withErrorCode(redirectTo, "task-assignee-mismatch"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "task-not-found"));
      }
    }
    throw error;
  }
}

export async function updateTaskStatusAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.status.update");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const parsed = updateTaskStatusSchema.safeParse({
    status: getFormString(formData, "status"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-status-validation"));
  }

  try {
    const before = await getTaskById(session, taskId);
    const updated = await updateTaskStatus(session, taskId, parsed.data);
    await logActivity({
      action: "task.status_change",
      module: "tasks",
      entityType: "TASK",
      entityId: updated.id,
      message: `Task status changed to ${updated.status}`,
      metadata: {
        fromStatus: before?.status ?? null,
        toStatus: updated.status,
      },
      servicePartnerId: updated.servicePartnerId,
    });
    try {
      await notifyTaskStatusChanged(updated.id, session.user.id);
    } catch (notificationError) {
      console.error("Task status notification failed", {
        taskId: updated.id,
        reason: notificationError instanceof Error ? notificationError.message.slice(0, 200) : "unknown",
      });
    }
    revalidateServiceRequestTaskPaths(updated.serviceRequestId);
    revalidateTaskDetailPath(updated.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-status-updated`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("child task")) {
        redirect(withErrorCode(redirectTo, "task-delete-blocked"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "task-not-found"));
      }
    }
    throw error;
  }
}

export async function deleteTaskAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.delete");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  try {
    const deleted = await softDeleteTask(session, taskId);
    await logActivity({
      action: "task.delete",
      module: "tasks",
      entityType: "TASK",
      entityId: deleted.id,
      message: "Task deleted",
      metadata: {
        taskNumber: deleted.taskNumber,
        parentTaskId: deleted.parentTaskId,
      },
      servicePartnerId: deleted.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(deleted.serviceRequestId);
    revalidateTaskDetailPath(deleted.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-deleted`);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      redirect(withErrorCode(redirectTo, "task-not-found"));
    }
    throw error;
  }
}

export async function logTaskResponsibilityChange(taskId: string) {
  const session = await requirePermission("tasks.update");
  const task = await getTaskById(session, taskId);
  if (!task) {
    return;
  }

  await logActivity({
    action: "task.assign",
    module: "tasks",
    entityType: "TASK",
    entityId: task.id,
    message: "Task responsibility updated",
    metadata: {
      assigneeUserId: task.assigneeUserId ?? null,
      assignedByUserId: task.assignedByUserId ?? null,
    },
    servicePartnerId: task.servicePartnerId,
  });
}

export async function createTaskRemarkAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.remark.create");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/tasks/${taskId}`);
  const parsed = createTaskRemarkSchema.safeParse({
    remark: getFormString(formData, "remark"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-remark-validation"));
  }

  try {
    const task = await createTaskRemark(session, taskId, parsed.data);
    await logActivity({
      action: "task.remark_create",
      module: "tasks",
      entityType: "TASK",
      entityId: task.id,
      message: "Task remark added",
      metadata: {
        remark: parsed.data.remark,
      },
      servicePartnerId: task.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(task.serviceRequestId);
    revalidateTaskDetailPath(task.id);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-remark-created`);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      redirect(withErrorCode(redirectTo, "task-not-found"));
    }
    throw error;
  }
}
