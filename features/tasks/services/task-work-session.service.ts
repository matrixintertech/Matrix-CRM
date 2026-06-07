import path from "node:path";

import { AttachmentType, TimeLogStatus, type Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { TaskWorkSessionInput } from "@/features/tasks/validations";
import { getTaskById } from "@/features/tasks/services/task.service";
import { hasPermission } from "@/lib/auth/permissions";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { measurePerf } from "@/lib/observability/perf";
import {
  canUploadTaskAttachments,
  deleteStorageObject,
  getStorageDriver,
  readStorageObject,
  uploadStorageObject,
} from "@/lib/storage/storage.service";

type MinimalTask = NonNullable<Awaited<ReturnType<typeof getTaskById>>>;

type RawTaskWorkSession = Prisma.TimeLogGetPayload<{
  include: {
    user: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
      };
    };
  };
}>;

type RawTaskAttachment = Prisma.AttachmentGetPayload<{
  include: {
    uploadedBy: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
      };
    };
  };
}>;

export type TaskWorkSessionSummary = {
  activeSessionCount: number;
  proofCount: number;
};

export type TaskExportMetrics = {
  latestCheckInAt: Date | null;
  latestCheckOutAt: Date | null;
  latestDurationMinutes: number | null;
  hasLocation: boolean;
  proofCount: number;
};

export type TaskWorkSessionView = {
  id: string;
  userId: string;
  status: TimeLogStatus;
  checkInAt: Date;
  checkOutAt: Date | null;
  checkInLatitude: number | null;
  checkInLongitude: number | null;
  checkOutLatitude: number | null;
  checkOutLongitude: number | null;
  checkInAddress: string | null;
  checkOutAddress: string | null;
  checkInNote: string | null;
  checkOutNote: string | null;
  durationMinutes: number | null;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
};

export type TaskAttachmentView = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: AttachmentType;
  note: string | null;
  createdAt: Date;
  fileUrl: string;
  uploadedBy: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

const ALLOWED_ATTACHMENT_TYPES: Record<
  string,
  {
    mimeTypes: string[];
    attachmentType: AttachmentType;
  }
> = {
  ".jpg": { mimeTypes: ["image/jpeg"], attachmentType: AttachmentType.IMAGE },
  ".jpeg": { mimeTypes: ["image/jpeg"], attachmentType: AttachmentType.IMAGE },
  ".png": { mimeTypes: ["image/png"], attachmentType: AttachmentType.IMAGE },
  ".webp": { mimeTypes: ["image/webp"], attachmentType: AttachmentType.IMAGE },
  ".pdf": { mimeTypes: ["application/pdf"], attachmentType: AttachmentType.PDF },
};

function sanitizeFileName(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, extension).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return {
    extension,
    safeFileName: `${baseName || "task-proof"}${extension}`,
  };
}

function toNullableNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function toDurationMinutes(checkInAt: Date, checkOutAt: Date | null) {
  if (!checkOutAt) {
    return null;
  }
  return Math.max(0, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000));
}

function buildTaskAttachmentUrl(attachmentId: string) {
  return `/api/task-attachments/${attachmentId}`;
}

async function requireVisibleTask(session: Session, taskId: string): Promise<MinimalTask> {
  const task = await getTaskById(session, taskId);
  if (!task) {
    throw new Error("Task not found.");
  }
  return task;
}

function getRequiredTaskIdentity(task: MinimalTask) {
  if (!task.id || !task.servicePartnerId || !task.serviceRequestId) {
    throw new Error("Task is missing required identifiers.");
  }

  return {
    taskId: task.id,
    servicePartnerId: task.servicePartnerId,
    serviceRequestId: task.serviceRequestId,
  };
}

async function canReadAllTaskSessions(session: Session) {
  return session.user.isSuperAdmin || (await hasPermission(session, "tasks.work_sessions.read"));
}

async function canReadTaskLocations(session: Session) {
  return session.user.isSuperAdmin || (await hasPermission(session, "tasks.location.read"));
}

async function canReadTaskAttachments(session: Session) {
  return session.user.isSuperAdmin || (await hasPermission(session, "tasks.attachments.read"));
}

function mapTaskWorkSession(row: RawTaskWorkSession, canReadLocation: boolean): TaskWorkSessionView {
  const locationFields = canReadLocation
    ? {
        checkInLatitude: toNullableNumber(row.punchInLat),
        checkInLongitude: toNullableNumber(row.punchInLng),
        checkOutLatitude: toNullableNumber(row.punchOutLat),
        checkOutLongitude: toNullableNumber(row.punchOutLng),
        checkInAddress: row.punchInAddress,
        checkOutAddress: row.punchOutAddress,
      }
    : {
        checkInLatitude: null,
        checkInLongitude: null,
        checkOutLatitude: null,
        checkOutLongitude: null,
        checkInAddress: null,
        checkOutAddress: null,
      };

  return {
    id: row.id,
    userId: row.userId,
    status: row.status,
    checkInAt: row.punchInAt,
    checkOutAt: row.punchOutAt,
    checkInNote: row.punchInNote,
    checkOutNote: row.punchOutNote,
    durationMinutes: toDurationMinutes(row.punchInAt, row.punchOutAt),
    user: row.user,
    ...locationFields,
  };
}

function mapTaskAttachment(row: RawTaskAttachment): TaskAttachmentView {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    attachmentType: row.attachmentType,
    note: row.note,
    createdAt: row.createdAt,
    fileUrl: buildTaskAttachmentUrl(row.id),
    uploadedBy: row.uploadedBy,
  };
}

function assertLocationRequirement(input: TaskWorkSessionInput) {
  if (!env().TASK_LOCATION_REQUIRED) {
    return;
  }

  if (input.latitude === undefined || input.longitude === undefined) {
    throw new Error("Location access is required to complete this action.");
  }
}

function assertTaskAssignee(task: MinimalTask, session: Session) {
  if (session.user.isSuperAdmin) {
    return;
  }

  if (!task.assigneeUserId || task.assigneeUserId !== session.user.id) {
    throw new Error("Only the assigned task user can complete this action.");
  }
}

async function getActiveSession(taskId: string, servicePartnerId: string, userId: string) {
  return prisma.timeLog.findFirst({
    where: {
      taskId,
      servicePartnerId,
      userId,
      punchOutAt: null,
      status: TimeLogStatus.CHECKED_IN,
    },
    orderBy: [{ punchInAt: "desc" }],
  });
}

export async function checkInToTask(session: Session, taskId: string, input: TaskWorkSessionInput) {
  return measurePerf("tasks.check_in", async () => {
    const task = await requireVisibleTask(session, taskId);
    const identity = getRequiredTaskIdentity(task);
    assertTaskAssignee(task, session);
    assertLocationRequirement(input);

    const activeSession = await getActiveSession(identity.taskId, identity.servicePartnerId, session.user.id);
    if (activeSession) {
      throw new Error("You already have an active check-in for this task.");
    }

    const created = (await prisma.timeLog.create({
      data: {
        servicePartnerId: identity.servicePartnerId,
        taskId: identity.taskId,
        userId: session.user.id,
        punchInAt: new Date(),
        punchInLat: input.latitude ?? null,
        punchInLng: input.longitude ?? null,
        punchInAddress: input.address ?? null,
        punchInNote: input.note ?? null,
        status: TimeLogStatus.CHECKED_IN,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    })) as RawTaskWorkSession;

    if (task.status === "YET_TO_START" || task.status === "REOPENED") {
      await prisma.task.update({
        where: { id: identity.taskId },
        data: {
          status: "IN_PROGRESS",
          startDate: task.startDate ?? new Date(),
        },
      });
    }

    await invalidateTenantDataCaches(identity.servicePartnerId);
    return {
      task,
      session: mapTaskWorkSession(created, true),
      locationCaptured: input.latitude !== undefined && input.longitude !== undefined,
    };
  });
}

export async function checkOutOfTask(
  session: Session,
  taskId: string,
  input: TaskWorkSessionInput,
  targetUserId?: string
  ) {
  return measurePerf("tasks.check_out", async () => {
    const task = await requireVisibleTask(session, taskId);
    const identity = getRequiredTaskIdentity(task);
    const resolvedUserId = targetUserId && session.user.isSuperAdmin ? targetUserId : session.user.id;

    if (resolvedUserId === session.user.id) {
      assertTaskAssignee(task, session);
    } else if (!session.user.isSuperAdmin) {
      throw new Error("You cannot check out another user's work session.");
    }

    assertLocationRequirement(input);

    const activeSession = await getActiveSession(identity.taskId, identity.servicePartnerId, resolvedUserId);
    if (!activeSession) {
      throw new Error("No active check-in was found for this task.");
    }

    const updated = (await prisma.timeLog.update({
      where: { id: activeSession.id },
      data: {
        punchOutAt: new Date(),
        punchOutLat: input.latitude ?? null,
        punchOutLng: input.longitude ?? null,
        punchOutAddress: input.address ?? null,
        punchOutNote: input.note ?? null,
        status: TimeLogStatus.CHECKED_OUT,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    })) as RawTaskWorkSession;

    await invalidateTenantDataCaches(identity.servicePartnerId);
    return {
      task,
      session: mapTaskWorkSession(updated, true),
      locationCaptured: input.latitude !== undefined && input.longitude !== undefined,
    };
  });
}

export async function getTaskWorkSessionBundle(session: Session, taskId: string) {
  return measurePerf("tasks.work_session_bundle", async () => {
    const task = await requireVisibleTask(session, taskId);
    const identity = getRequiredTaskIdentity(task);
    const [canReadAllSessionsValue, canReadLocationsValue, canReadAttachmentsValue] = await Promise.all([
      canReadAllTaskSessions(session),
      canReadTaskLocations(session),
      canReadTaskAttachments(session),
    ]);

    const [sessions, attachments] = await Promise.all([
      prisma.timeLog.findMany({
        where: {
          servicePartnerId: identity.servicePartnerId,
          taskId: identity.taskId,
          ...(canReadAllSessionsValue ? {} : { userId: session.user.id }),
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: [{ punchInAt: "desc" }],
      }),
      canReadAttachmentsValue
        ? prisma.attachment.findMany({
            where: {
              servicePartnerId: identity.servicePartnerId,
              taskId: identity.taskId,
              deletedAt: null,
            },
            include: {
              uploadedBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                },
              },
            },
            orderBy: [{ createdAt: "desc" }],
          })
        : Promise.resolve([]),
    ]);

    const currentUserActiveSession = sessions.find(
      (row) => row.userId === session.user.id && row.status === TimeLogStatus.CHECKED_IN && row.punchOutAt === null
    );

    return {
      task,
      currentUserActiveSession: currentUserActiveSession ? mapTaskWorkSession(currentUserActiveSession, true) : null,
      sessions: sessions.map((row) => mapTaskWorkSession(row, canReadLocationsValue || row.userId === session.user.id)),
      attachments: attachments.map(mapTaskAttachment),
      summary: {
        activeSessionCount: sessions.filter((row) => row.status === TimeLogStatus.CHECKED_IN && row.punchOutAt === null).length,
        proofCount: attachments.length,
      },
      canReadAllSessions: canReadAllSessionsValue,
      canReadLocations: canReadLocationsValue,
      canReadAttachments: canReadAttachmentsValue,
    };
  });
}

export async function getTaskExecutionSummaryMap(taskIds: string[]): Promise<Map<string, TaskWorkSessionSummary>> {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (uniqueTaskIds.length === 0) {
    return new Map();
  }

  const [activeSessions, attachments] = await Promise.all([
    prisma.timeLog.groupBy({
      by: ["taskId"],
      where: {
        taskId: {
          in: uniqueTaskIds,
        },
        status: TimeLogStatus.CHECKED_IN,
        punchOutAt: null,
      },
      _count: {
        _all: true,
      },
    }),
    prisma.attachment.groupBy({
      by: ["taskId"],
      where: {
        taskId: {
          in: uniqueTaskIds,
        },
        deletedAt: null,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const summaryMap = new Map<string, TaskWorkSessionSummary>();
  for (const taskId of uniqueTaskIds) {
    summaryMap.set(taskId, {
      activeSessionCount: 0,
      proofCount: 0,
    });
  }

  for (const row of activeSessions) {
    if (!row.taskId) {
      continue;
    }
    summaryMap.set(row.taskId, {
      ...(summaryMap.get(row.taskId) ?? { activeSessionCount: 0, proofCount: 0 }),
      activeSessionCount: row._count._all,
    });
  }

  for (const row of attachments) {
    if (!row.taskId) {
      continue;
    }
    summaryMap.set(row.taskId, {
      ...(summaryMap.get(row.taskId) ?? { activeSessionCount: 0, proofCount: 0 }),
      proofCount: row._count._all,
    });
  }

  return summaryMap;
}

export async function getTaskExportMetricsMap(taskIds: string[]): Promise<Map<string, TaskExportMetrics>> {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (uniqueTaskIds.length === 0) {
    return new Map();
  }

  const [latestSessions, attachments] = await Promise.all([
    prisma.timeLog.findMany({
      where: {
        taskId: {
          in: uniqueTaskIds,
        },
      },
      orderBy: [{ taskId: "asc" }, { punchInAt: "desc" }],
      select: {
        taskId: true,
        punchInAt: true,
        punchOutAt: true,
        punchInLat: true,
        punchInLng: true,
        punchOutLat: true,
        punchOutLng: true,
      },
    }),
    prisma.attachment.groupBy({
      by: ["taskId"],
      where: {
        taskId: {
          in: uniqueTaskIds,
        },
        deletedAt: null,
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const metricsMap = new Map<string, TaskExportMetrics>();
  for (const taskId of uniqueTaskIds) {
    metricsMap.set(taskId, {
      latestCheckInAt: null,
      latestCheckOutAt: null,
      latestDurationMinutes: null,
      hasLocation: false,
      proofCount: 0,
    });
  }

  for (const row of latestSessions) {
    if (metricsMap.get(row.taskId)?.latestCheckInAt) {
      continue;
    }
    metricsMap.set(row.taskId, {
      ...(metricsMap.get(row.taskId) ?? {
        latestCheckInAt: null,
        latestCheckOutAt: null,
        latestDurationMinutes: null,
        hasLocation: false,
        proofCount: 0,
      }),
      latestCheckInAt: row.punchInAt,
      latestCheckOutAt: row.punchOutAt,
      latestDurationMinutes: toDurationMinutes(row.punchInAt, row.punchOutAt),
      hasLocation:
        row.punchInLat !== null || row.punchInLng !== null || row.punchOutLat !== null || row.punchOutLng !== null,
    });
  }

  for (const row of attachments) {
    if (!row.taskId) {
      continue;
    }
    metricsMap.set(row.taskId, {
      ...(metricsMap.get(row.taskId) ?? {
        latestCheckInAt: null,
        latestCheckOutAt: null,
        latestDurationMinutes: null,
        hasLocation: false,
        proofCount: 0,
      }),
      proofCount: row._count._all,
    });
  }

  return metricsMap;
}

export async function uploadTaskAttachment(session: Session, taskId: string, input: { file: File; note?: string | null }) {
  return measurePerf("tasks.attachment_upload", async () => {
    if (!(await hasPermission(session, "tasks.attachments.upload")) && !session.user.isSuperAdmin) {
      throw new Error("You do not have permission to upload task proofs.");
    }

    if (!canUploadTaskAttachments()) {
      const driver = getStorageDriver();
      if (env().IS_PRODUCTION && driver !== "s3") {
        throw new Error("Task proof uploads require S3 or R2 storage in production.");
      }
      throw new Error("Task proof uploads are not configured.");
    }

    const task = await requireVisibleTask(session, taskId);
    const identity = getRequiredTaskIdentity(task);
    const file = input.file;
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error("Select a valid proof file to upload.");
    }

    const { extension, safeFileName } = sanitizeFileName(file.name);
    const allowedType = ALLOWED_ATTACHMENT_TYPES[extension];
    if (!allowedType || !allowedType.mimeTypes.includes(file.type)) {
      throw new Error("Only JPG, JPEG, PNG, WEBP, and PDF task proofs are allowed.");
    }

    const maxBytes = env().TASK_ATTACHMENT_MAX_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`Task proof exceeds the ${env().TASK_ATTACHMENT_MAX_MB}MB upload limit.`);
    }

    const attachmentId = crypto.randomUUID();
    const storageKey = `task-attachments/${identity.servicePartnerId}/${identity.taskId}/${attachmentId}-${safeFileName}`;
    const body = new Uint8Array(await file.arrayBuffer());

    await uploadStorageObject({
      key: storageKey,
      body,
      contentType: file.type,
    });

    try {
      const created = (await prisma.attachment.create({
        data: {
          id: attachmentId,
          servicePartnerId: identity.servicePartnerId,
          taskId: identity.taskId,
          uploadedByUserId: session.user.id,
          fileName: safeFileName,
          fileUrl: buildTaskAttachmentUrl(attachmentId),
          storageKey,
          mimeType: file.type,
          fileSize: file.size,
          attachmentType: allowedType.attachmentType,
          note: input.note?.trim() || null,
        },
        include: {
          uploadedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      })) as RawTaskAttachment;

      await invalidateTenantDataCaches(identity.servicePartnerId);
      return {
        task,
        attachment: mapTaskAttachment(created),
      };
    } catch (error) {
      await deleteStorageObject(storageKey);
      throw error;
    }
  });
}

export async function deleteTaskAttachment(session: Session, attachmentId: string) {
  return measurePerf("tasks.attachment_delete", async () => {
    if (!(await hasPermission(session, "tasks.attachments.delete")) && !session.user.isSuperAdmin) {
      throw new Error("You do not have permission to delete task proofs.");
    }

    const attachment = await prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        deletedAt: null,
        taskId: {
          not: null,
        },
      },
      include: {
        uploadedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!attachment?.taskId) {
      throw new Error("Task proof not found.");
    }

    const task = await requireVisibleTask(session, attachment.taskId);
    const identity = getRequiredTaskIdentity(task);

    await prisma.attachment.update({
      where: { id: attachment.id },
      data: {
        deletedAt: new Date(),
      },
    });

    if (attachment.storageKey) {
      await deleteStorageObject(attachment.storageKey);
    }

    await invalidateTenantDataCaches(identity.servicePartnerId);
    return {
      task,
      attachment: mapTaskAttachment(attachment),
    };
  });
}

export async function getTaskAttachmentDownload(session: Session, attachmentId: string) {
  return measurePerf("tasks.attachment_download", async () => {
    if (!(await canReadTaskAttachments(session))) {
      throw new Error("You do not have permission to read task proofs.");
    }

    const attachment = await prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        deletedAt: null,
        taskId: {
          not: null,
        },
      },
    });

    if (!attachment?.taskId) {
      throw new Error("Task proof not found.");
    }

    await requireVisibleTask(session, attachment.taskId);
    if (!attachment.storageKey) {
      throw new Error("Stored proof is missing its storage key.");
    }

    const storedObject = await readStorageObject(attachment.storageKey, attachment.mimeType);
    return {
      fileName: attachment.fileName,
      mimeType: storedObject.contentType,
      body: storedObject.body,
    };
  });
}
