"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createTaskRemarkSchema,
  createTaskSchema,
  taskWorkSessionSchema,
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
import {
  checkInToTask,
  checkOutOfTask,
  deleteTaskAttachment,
  uploadTaskAttachment,
} from "@/features/tasks/services/task-work-session.service";
import { logActivity } from "@/lib/activity/activity-log";
import { requireAnyPermission, requirePermission } from "@/lib/auth/rbac";
import { notifyTaskAssigned, notifyTaskStatusChanged, notifyTaskUpdated } from "@/lib/notifications/notification.service";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : undefined;
}

function getFormFile(formData: FormData, key: string) {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

function withErrorCode(path: string, code: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}error=${encodeURIComponent(code)}`;
}

function requireId(value: string | null | undefined, message: string) {
  if (!value) {
    throw new Error(message);
  }
  return value;
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

export async function checkInToTaskAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.check_in");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/tasks/${taskId}`);
  const parsed = taskWorkSessionSchema.safeParse({
    note: getFormString(formData, "note"),
    latitude: getFormString(formData, "latitude"),
    longitude: getFormString(formData, "longitude"),
    address: getFormString(formData, "address"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-checkin-validation"));
  }

  try {
    const result = await checkInToTask(session, taskId, parsed.data);
    const resolvedTaskId = requireId(result.task.id, "Task id missing after check-in.");
    const resolvedServiceRequestId = requireId(result.task.serviceRequestId, "Service request id missing after check-in.");
    await logActivity({
      action: "task.check_in",
      module: "tasks",
      entityType: "TASK",
      entityId: result.task.id,
      message: "Task check-in recorded",
      metadata: {
        userId: result.session.userId,
        checkInAt: result.session.checkInAt.toISOString(),
        locationCaptured: result.locationCaptured,
      },
      servicePartnerId: result.task.servicePartnerId,
    });
    if (result.locationCaptured) {
      await logActivity({
        action: "task.location_captured",
        module: "tasks",
        entityType: "TASK",
        entityId: result.task.id,
        message: "Task check-in location captured",
        metadata: {
          stage: "check_in",
          userId: result.session.userId,
        },
        servicePartnerId: result.task.servicePartnerId,
      });
    }
    revalidateServiceRequestTaskPaths(resolvedServiceRequestId);
    revalidateTaskDetailPath(resolvedTaskId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-checked-in`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("active check-in")) {
        redirect(withErrorCode(redirectTo, "task-checkin-active"));
      }
      if (lower.includes("location")) {
        redirect(withErrorCode(redirectTo, "task-location-required"));
      }
      if (lower.includes("assigned task user")) {
        redirect(withErrorCode(redirectTo, "task-checkin-assignee-only"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "task-not-found"));
      }
    }
    throw error;
  }
}

export async function checkOutOfTaskAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.check_out");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/tasks/${taskId}`);
  const parsed = taskWorkSessionSchema.safeParse({
    note: getFormString(formData, "note"),
    latitude: getFormString(formData, "latitude"),
    longitude: getFormString(formData, "longitude"),
    address: getFormString(formData, "address"),
  });

  if (!parsed.success) {
    redirect(withErrorCode(redirectTo, "task-checkout-validation"));
  }

  try {
    const result = await checkOutOfTask(session, taskId, parsed.data);
    const resolvedTaskId = requireId(result.task.id, "Task id missing after check-out.");
    const resolvedServiceRequestId = requireId(result.task.serviceRequestId, "Service request id missing after check-out.");
    await logActivity({
      action: "task.check_out",
      module: "tasks",
      entityType: "TASK",
      entityId: result.task.id,
      message: "Task check-out recorded",
      metadata: {
        userId: result.session.userId,
        checkOutAt: result.session.checkOutAt?.toISOString() ?? null,
        durationMinutes: result.session.durationMinutes,
        locationCaptured: result.locationCaptured,
      },
      servicePartnerId: result.task.servicePartnerId,
    });
    if (result.locationCaptured) {
      await logActivity({
        action: "task.location_captured",
        module: "tasks",
        entityType: "TASK",
        entityId: result.task.id,
        message: "Task check-out location captured",
        metadata: {
          stage: "check_out",
          userId: result.session.userId,
        },
        servicePartnerId: result.task.servicePartnerId,
      });
    }
    revalidateServiceRequestTaskPaths(resolvedServiceRequestId);
    revalidateTaskDetailPath(resolvedTaskId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-checked-out`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("no active check-in")) {
        redirect(withErrorCode(redirectTo, "task-checkout-missing"));
      }
      if (lower.includes("location")) {
        redirect(withErrorCode(redirectTo, "task-location-required"));
      }
      if (lower.includes("assigned task user")) {
        redirect(withErrorCode(redirectTo, "task-checkout-assignee-only"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "task-not-found"));
      }
    }
    throw error;
  }
}

export async function uploadTaskAttachmentAction(taskId: string, formData: FormData) {
  const session = await requirePermission("tasks.attachments.upload");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/tasks/${taskId}`);
  const file = getFormFile(formData, "file");

  if (!file) {
    redirect(withErrorCode(redirectTo, "task-attachment-validation"));
  }

  try {
    const result = await uploadTaskAttachment(session, taskId, {
      file,
      note: getFormString(formData, "note"),
    });
    const resolvedTaskId = requireId(result.task.id, "Task id missing after attachment upload.");
    const resolvedServiceRequestId = requireId(result.task.serviceRequestId, "Service request id missing after attachment upload.");
    await logActivity({
      action: "task.attachment_upload",
      module: "tasks",
      entityType: "TASK",
      entityId: result.task.id,
      message: "Task proof uploaded",
      metadata: {
        attachmentId: result.attachment.id,
        attachmentType: result.attachment.attachmentType,
        fileName: result.attachment.fileName,
      },
      servicePartnerId: result.task.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(resolvedServiceRequestId);
    revalidateTaskDetailPath(resolvedTaskId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-attachment-uploaded`);
  } catch (error) {
    if (error instanceof Error) {
      const lower = error.message.toLowerCase();
      if (lower.includes("allowed") || lower.includes("valid proof") || lower.includes("upload limit")) {
        redirect(withErrorCode(redirectTo, "task-attachment-validation"));
      }
      if (lower.includes("configured") || lower.includes("require s3")) {
        redirect(withErrorCode(redirectTo, "task-attachment-storage"));
      }
      if (lower.includes("not found")) {
        redirect(withErrorCode(redirectTo, "task-not-found"));
      }
    }
    throw error;
  }
}

export async function deleteTaskAttachmentAction(taskId: string, attachmentId: string, formData: FormData) {
  const session = await requirePermission("tasks.attachments.delete");
  const redirectTo = getSafeRedirectPath(formData.get("redirectTo"), `/tasks/${taskId}`);

  try {
    const result = await deleteTaskAttachment(session, attachmentId);
    const resolvedTaskId = requireId(result.task.id, "Task id missing after attachment delete.");
    const resolvedServiceRequestId = requireId(result.task.serviceRequestId, "Service request id missing after attachment delete.");
    await logActivity({
      action: "task.attachment_delete",
      module: "tasks",
      entityType: "TASK",
      entityId: result.task.id,
      message: "Task proof deleted",
      metadata: {
        attachmentId: result.attachment.id,
        fileName: result.attachment.fileName,
      },
      servicePartnerId: result.task.servicePartnerId,
    });
    revalidateServiceRequestTaskPaths(resolvedServiceRequestId);
    revalidateTaskDetailPath(resolvedTaskId);
    redirect(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}success=task-attachment-deleted`);
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
      redirect(withErrorCode(redirectTo, "task-attachment-not-found"));
    }
    throw error;
  }
}
