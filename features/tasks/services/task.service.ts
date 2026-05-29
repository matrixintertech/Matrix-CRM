import { TaskStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { CreateTaskInput, UpdateTaskInput, UpdateTaskStatusInput } from "@/features/tasks/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function toYyyyMmDd(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function generateTaskNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `TSK-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.task.findFirst({
      where: {
        servicePartnerId,
        taskNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique task number.");
}

async function getServiceRequestForTaskScope(session: Session, serviceRequestId: string) {
  return prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    select: {
      id: true,
      servicePartnerId: true,
      serviceNumber: true,
      title: true,
    },
  });
}

async function assertAssignee(servicePartnerId: string, assigneeUserId?: string) {
  if (!assigneeUserId) {
    return;
  }

  const assignee = await prisma.user.findFirst({
    where: {
      id: assigneeUserId,
      servicePartnerId,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!assignee) {
    throw new Error("Task assignee is invalid for this tenant.");
  }
}

export async function listTaskResponsibilityUsers(session: Session, servicePartnerId: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;
  return prisma.user.findMany({
    where: {
      servicePartnerId: resolvedServicePartnerId,
      status: "ACTIVE",
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }, { email: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      roles: {
        where: {
          role: {
            deletedAt: null,
          },
        },
        select: {
          role: {
            select: {
              key: true,
              name: true,
            },
          },
        },
      },
    },
  });
}

export async function listTasksForServiceRequest(session: Session, serviceRequestId: string) {
  const serviceRequest = await getServiceRequestForTaskScope(session, serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  const tasks = await prisma.task.findMany({
    where: {
      serviceRequestId: serviceRequest.id,
      servicePartnerId: serviceRequest.servicePartnerId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  return {
    serviceRequest,
    tasks,
  };
}

export async function createTask(session: Session, input: CreateTaskInput) {
  const serviceRequest = await getServiceRequestForTaskScope(session, input.serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  await assertAssignee(serviceRequest.servicePartnerId, input.assigneeUserId);

  const taskNumber = await generateTaskNumber(serviceRequest.servicePartnerId);
  return prisma.task.create({
    data: {
      servicePartnerId: serviceRequest.servicePartnerId,
      serviceRequestId: serviceRequest.id,
      taskNumber,
      title: input.title.trim(),
      description: normalizeOptionalString(input.description),
      assigneeUserId: input.assigneeUserId ?? null,
      status: input.status,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedAt: input.status === TaskStatus.COMPLETED ? new Date() : null,
      createdByUserId: session.user.id,
    },
  });
}

export async function getTaskById(session: Session, taskId: string) {
  return prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });
}

export async function updateTask(session: Session, taskId: string, input: UpdateTaskInput) {
  const existing = await getTaskById(session, taskId);
  if (!existing) {
    throw new Error("Task not found.");
  }

  await assertAssignee(existing.servicePartnerId, input.assigneeUserId);

  const completedAt =
    input.status === TaskStatus.COMPLETED
      ? existing.completedAt ?? new Date()
      : input.status === TaskStatus.REOPENED || input.status === TaskStatus.YET_TO_START || input.status === TaskStatus.IN_PROGRESS || input.status === TaskStatus.BLOCKED
        ? null
        : existing.completedAt;

  return prisma.task.update({
    where: { id: taskId },
    data: {
      title: input.title.trim(),
      description: normalizeOptionalString(input.description),
      assigneeUserId: input.assigneeUserId ?? null,
      status: input.status,
      startDate: input.startDate ?? null,
      dueDate: input.dueDate ?? null,
      completedAt,
    },
  });
}

export async function updateTaskStatus(session: Session, taskId: string, input: UpdateTaskStatusInput) {
  const existing = await getTaskById(session, taskId);
  if (!existing) {
    throw new Error("Task not found.");
  }

  const completedAt =
    input.status === TaskStatus.COMPLETED
      ? existing.completedAt ?? new Date()
      : input.status === TaskStatus.REOPENED || input.status === TaskStatus.YET_TO_START || input.status === TaskStatus.IN_PROGRESS || input.status === TaskStatus.BLOCKED
        ? null
        : existing.completedAt;

  return prisma.task.update({
    where: { id: taskId },
    data: {
      status: input.status,
      completedAt,
    },
  });
}

export async function softDeleteTask(session: Session, taskId: string) {
  const existing = await getTaskById(session, taskId);
  if (!existing) {
    throw new Error("Task not found.");
  }

  return prisma.task.update({
    where: { id: taskId },
    data: {
      deletedAt: new Date(),
    },
  });
}
