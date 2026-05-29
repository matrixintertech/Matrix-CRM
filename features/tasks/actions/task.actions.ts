"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createTaskSchema, updateTaskSchema, updateTaskStatusSchema } from "@/features/tasks/validations";
import {
  createTask,
  getTaskById,
  softDeleteTask,
  updateTask,
  updateTaskStatus,
} from "@/features/tasks/services/task.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requirePermission } from "@/lib/auth/rbac";
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
  revalidatePath("/service-requests");
  revalidatePath(`/service-requests/${serviceRequestId}`);
}

export async function createTaskAction(formData: FormData) {
  const session = await requirePermission("tasks.create");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), "/service-requests");

  const parsed = createTaskSchema.safeParse({
    serviceRequestId: getFormString(formData, "serviceRequestId"),
    title: getFormString(formData, "title"),
    description: getFormString(formData, "description"),
    assigneeUserId: getFormString(formData, "assigneeUserId"),
    status: getFormString(formData, "status"),
    startDate: getFormString(formData, "startDate"),
    dueDate: getFormString(formData, "dueDate"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-validation"));
  }

  try {
    const created = await createTask(session, parsed.data);
    await logActivity({
      action: "work_item.create",
      module: "tasks",
      entityType: "TASK",
      entityId: created.id,
      message: "Work item created",
      metadata: {
        taskNumber: created.taskNumber,
        serviceRequestId: created.serviceRequestId,
      },
      servicePartnerId: created.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(created.serviceRequestId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-created`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
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
    startDate: getFormString(formData, "startDate"),
    dueDate: getFormString(formData, "dueDate"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-validation"));
  }

  try {
    const updated = await updateTask(session, taskId, parsed.data);
    await logActivity({
      action: "work_item.update",
      module: "tasks",
      entityType: "TASK",
      entityId: updated.id,
      message: "Work item updated",
      metadata: {
        status: updated.status,
        assigneeUserId: updated.assigneeUserId,
      },
      servicePartnerId: updated.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(updated.serviceRequestId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-updated`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
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
    const updated = await updateTaskStatus(session, taskId, parsed.data);
    await logActivity({
      action: "work_item.status_change",
      module: "tasks",
      entityType: "TASK",
      entityId: updated.id,
      message: `Work item status changed to ${updated.status}`,
      metadata: {
        status: updated.status,
      },
      servicePartnerId: updated.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(updated.serviceRequestId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-status-updated`);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      redirect(withErrorCode(redirectTo, "task-not-found"));
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
      action: "work_item.delete",
      module: "tasks",
      entityType: "TASK",
      entityId: deleted.id,
      message: "Work item deleted",
      metadata: {
        taskNumber: deleted.taskNumber,
      },
      servicePartnerId: deleted.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(deleted.serviceRequestId);
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
    action: "work_item.responsibility_update",
    module: "tasks",
    entityType: "TASK",
    entityId: task.id,
    message: "Work item responsibility updated",
    metadata: {
      assigneeUserId: task.assigneeUserId ?? null,
    },
    servicePartnerId: task.servicePartnerId,
  });
}
