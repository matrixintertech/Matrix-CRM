import type { Prisma } from "@prisma/client";

import { sendTransactionalEmail } from "@/features/auth/services/otp-provider.service";
import { prisma } from "@/lib/db/prisma";

type NotificationRecipient = {
  id: string;
  servicePartnerId: string;
  email: string | null;
  name: string | null;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  deletedAt: Date | null;
};

type NotificationInput = {
  actorUserId?: string | null;
  servicePartnerId: string;
  subject: string;
  body: string;
  templateKey: string;
  recipients: NotificationRecipient[];
  metadata?: Prisma.InputJsonValue;
};

function dedupeRecipients(recipients: NotificationRecipient[], servicePartnerId: string, actorUserId?: string | null) {
  const unique = new Map<string, NotificationRecipient>();

  for (const recipient of recipients) {
    if (!recipient.id || unique.has(recipient.id)) {
      continue;
    }

    if (recipient.id === actorUserId) {
      continue;
    }

    if (recipient.servicePartnerId !== servicePartnerId) {
      continue;
    }

    if (recipient.status !== "ACTIVE" || recipient.deletedAt !== null || !recipient.email) {
      continue;
    }

    unique.set(recipient.id, recipient);
  }

  return Array.from(unique.values());
}

export async function sendEmailNotifications(input: NotificationInput) {
  const recipients = dedupeRecipients(input.recipients, input.servicePartnerId, input.actorUserId);
  if (recipients.length === 0) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const created = await prisma.notification.create({
      data: {
        servicePartnerId: input.servicePartnerId,
        recipientUserId: recipient.id,
        createdByUserId: input.actorUserId ?? null,
        channel: "EMAIL",
        status: "PENDING",
        subject: input.subject,
        body: input.body,
        templateKey: input.templateKey,
        metadata: input.metadata,
      },
      select: { id: true },
    });

    try {
      const delivery = await sendTransactionalEmail({
        to: recipient.email!,
        subject: input.subject,
        text: input.body,
        html: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; white-space: pre-line;">${input.body}</div>`,
      });

      if (delivery.ok) {
        sent += 1;
        await prisma.notification.update({
          where: { id: created.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
          },
        });
        continue;
      }
    } catch {
      // Keep mutation flows resilient and record the notification as failed.
    }

    failed += 1;
    await prisma.notification.update({
      where: { id: created.id },
      data: {
        status: "FAILED",
      },
    });
  }

  return {
    attempted: recipients.length,
    sent,
    failed,
  };
}

type ServiceRequestUserRecord = {
  id: string;
  servicePartnerId: string;
  email: string | null;
  name: string | null;
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  deletedAt: Date | null;
};

function pushUser(list: ServiceRequestUserRecord[], user: ServiceRequestUserRecord | null | undefined) {
  if (user) {
    list.push(user);
  }
}

function pushTaskParentUsers(
  list: ServiceRequestUserRecord[],
  parentTask:
    | {
        assignee: ServiceRequestUserRecord | null;
        assignedBy: ServiceRequestUserRecord | null;
        createdBy?: ServiceRequestUserRecord | null;
      }
    | null
    | undefined
) {
  if (!parentTask) {
    return;
  }

  pushUser(list, parentTask.assignee);
  pushUser(list, parentTask.assignedBy);
  pushUser(list, parentTask.createdBy);
}

function pushServiceRequestResponsibleUsers(
  list: ServiceRequestUserRecord[],
  serviceRequest:
    | {
        assignments: {
          user: ServiceRequestUserRecord | null;
        }[];
      }
    | null
    | undefined
) {
  if (!serviceRequest) {
    return;
  }

  for (const assignment of serviceRequest.assignments) {
    pushUser(list, assignment.user);
  }
}

export async function getTaskNotificationContext(taskId: string) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      deletedAt: null,
    },
    include: {
      assignee: {
        select: {
          id: true,
          servicePartnerId: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          servicePartnerId: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
        },
      },
      assignedBy: {
        select: {
          id: true,
          servicePartnerId: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
        },
      },
      parentTask: {
        select: {
          id: true,
          taskNumber: true,
          assignee: {
            select: {
              id: true,
              servicePartnerId: true,
              email: true,
              name: true,
              status: true,
              deletedAt: true,
            },
          },
          assignedBy: {
            select: {
              id: true,
              servicePartnerId: true,
              email: true,
              name: true,
              status: true,
              deletedAt: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              servicePartnerId: true,
              email: true,
              name: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
      serviceRequest: {
        select: {
          id: true,
          serviceNumber: true,
          title: true,
          servicePartnerId: true,
          createdByUser: {
            select: {
              id: true,
              servicePartnerId: true,
              email: true,
              name: true,
              status: true,
              deletedAt: true,
            },
          },
          createdByClientUser: {
            select: {
              user: {
                select: {
                  id: true,
                  servicePartnerId: true,
                  email: true,
                  name: true,
                  status: true,
                  deletedAt: true,
                },
              },
            },
          },
          assignments: {
            where: {
              unassignedAt: null,
            },
            select: {
              user: {
                select: {
                  id: true,
                  servicePartnerId: true,
                  email: true,
                  name: true,
                  status: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!task) {
    return null;
  }

  return {
    task,
  };
}

export async function getServiceRequestNotificationContext(serviceRequestId: string) {
  const serviceRequest = await prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      serviceNumber: true,
      title: true,
      createdByUser: {
        select: {
          id: true,
          servicePartnerId: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
        },
      },
      createdByClientUser: {
        select: {
          user: {
            select: {
              id: true,
              servicePartnerId: true,
              email: true,
              name: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
      assignments: {
        where: {
          unassignedAt: null,
        },
        select: {
          role: true,
          user: {
            select: {
              id: true,
              servicePartnerId: true,
              email: true,
              name: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });

  if (!serviceRequest) {
    return null;
  }

  const recipients: ServiceRequestUserRecord[] = [];
  pushUser(recipients, serviceRequest.createdByUser);
  pushUser(recipients, serviceRequest.createdByClientUser?.user);
  for (const assignment of serviceRequest.assignments) {
    pushUser(recipients, assignment.user);
  }

  return {
    serviceRequest,
    recipients,
  };
}

export async function getTaskAssignmentNotificationRecipients(taskId: string, actorUserId?: string | null) {
  const context = await getTaskNotificationContext(taskId);
  if (!context) {
    return [];
  }

  const recipients: ServiceRequestUserRecord[] = [];
  pushUser(recipients, context.task.assignee);
  pushTaskParentUsers(recipients, context.task.parentTask);
  return dedupeRecipients(recipients, context.task.servicePartnerId, actorUserId);
}

export async function getTaskUpdateNotificationRecipients(taskId: string, actorUserId?: string | null) {
  const context = await getTaskNotificationContext(taskId);
  if (!context) {
    return [];
  }

  const recipients: ServiceRequestUserRecord[] = [];
  pushUser(recipients, context.task.assignee);
  pushUser(recipients, context.task.assignedBy);
  pushUser(recipients, context.task.createdBy);
  pushTaskParentUsers(recipients, context.task.parentTask);
  pushServiceRequestResponsibleUsers(recipients, context.task.serviceRequest);
  return dedupeRecipients(recipients, context.task.servicePartnerId, actorUserId);
}

export async function getTaskStatusNotificationRecipients(taskId: string, actorUserId?: string | null) {
  const context = await getTaskNotificationContext(taskId);
  if (!context) {
    return [];
  }

  const recipients: ServiceRequestUserRecord[] = [];
  pushUser(recipients, context.task.assignee);
  pushUser(recipients, context.task.assignedBy);
  pushTaskParentUsers(recipients, context.task.parentTask);
  pushServiceRequestResponsibleUsers(recipients, context.task.serviceRequest);
  return dedupeRecipients(recipients, context.task.servicePartnerId, actorUserId);
}

export async function notifyTaskAssigned(taskId: string, actorUserId?: string | null) {
  const context = await getTaskNotificationContext(taskId);
  if (!context) {
    return null;
  }

  const recipients = await getTaskAssignmentNotificationRecipients(taskId, actorUserId);

  const actionLabel = context.task.parentTask ? "delegated" : "assigned";

  return sendEmailNotifications({
    actorUserId,
    servicePartnerId: context.task.servicePartnerId,
    subject: `Task ${actionLabel}: ${context.task.taskNumber}`,
    body: [
      `Task: ${context.task.title}`,
      `Task Number: ${context.task.taskNumber}`,
      `Service Request: ${context.task.serviceRequest.serviceNumber}`,
      context.task.parentTask ? `Parent Task: ${context.task.parentTask.taskNumber}` : "",
      "",
      context.task.parentTask
        ? "A sub-task has been delegated within a task chain you are involved in."
        : "A task has been assigned to you.",
    ]
      .filter(Boolean)
      .join("\n"),
    templateKey: "task.assigned",
    recipients,
    metadata: {
      taskId: context.task.id,
      taskNumber: context.task.taskNumber,
      serviceRequestId: context.task.serviceRequestId,
      parentTaskId: context.task.parentTaskId,
    },
  });
}

export async function notifyTaskUpdated(taskId: string, actorUserId?: string | null) {
  const context = await getTaskNotificationContext(taskId);
  if (!context) {
    return null;
  }

  const recipients = await getTaskUpdateNotificationRecipients(taskId, actorUserId);

  return sendEmailNotifications({
    actorUserId,
    servicePartnerId: context.task.servicePartnerId,
    subject: `Task updated: ${context.task.taskNumber}`,
    body: [
      `Task: ${context.task.title}`,
      `Task Number: ${context.task.taskNumber}`,
      `Service Request: ${context.task.serviceRequest.serviceNumber}`,
      `Status: ${context.task.status}`,
      "",
      "A task you are directly responsible for or supervising has been updated.",
    ].join("\n"),
    templateKey: "task.updated",
    recipients,
    metadata: {
      taskId: context.task.id,
      taskNumber: context.task.taskNumber,
      serviceRequestId: context.task.serviceRequestId,
      status: context.task.status,
    },
  });
}

export async function notifyTaskStatusChanged(taskId: string, actorUserId?: string | null) {
  const context = await getTaskNotificationContext(taskId);
  if (!context) {
    return null;
  }

  const recipients = await getTaskStatusNotificationRecipients(taskId, actorUserId);

  return sendEmailNotifications({
    actorUserId,
    servicePartnerId: context.task.servicePartnerId,
    subject: `Task status changed: ${context.task.taskNumber}`,
    body: [
      `Task: ${context.task.title}`,
      `Task Number: ${context.task.taskNumber}`,
      `New Status: ${context.task.status}`,
      `Service Request: ${context.task.serviceRequest.serviceNumber}`,
      context.task.parentTask ? `Parent Task: ${context.task.parentTask.taskNumber}` : "",
    ].join("\n"),
    templateKey: "task.status_changed",
    recipients,
    metadata: {
      taskId: context.task.id,
      taskNumber: context.task.taskNumber,
      serviceRequestId: context.task.serviceRequestId,
      status: context.task.status,
    },
  });
}

export async function notifyServiceRequestResponsibilitiesUpdated(serviceRequestId: string, actorUserId?: string | null) {
  const context = await getServiceRequestNotificationContext(serviceRequestId);
  if (!context) {
    return null;
  }

  return sendEmailNotifications({
    actorUserId,
    servicePartnerId: context.serviceRequest.servicePartnerId,
    subject: `Service request responsibility updated: ${context.serviceRequest.serviceNumber}`,
    body: [
      `Service Request: ${context.serviceRequest.title}`,
      `Request Number: ${context.serviceRequest.serviceNumber}`,
      "",
      "Assigned responsibility has been updated for this service request.",
    ].join("\n"),
    templateKey: "service_request.responsibility_updated",
    recipients: context.recipients,
    metadata: {
      serviceRequestId: context.serviceRequest.id,
      serviceNumber: context.serviceRequest.serviceNumber,
    },
  });
}
