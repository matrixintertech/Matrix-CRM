import { EmailChangeRequestStatus, OtpPurpose, Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import { sendOtpChallengeToKnownTarget, verifyOtpForTarget } from "@/features/auth/services/otp.service";
import { sendTransactionalEmail } from "@/features/auth/services/otp-provider.service";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isScopedToTenant(session: Session) {
  return !session.user.isSuperAdmin;
}

function getEmailChangeRequestScope(session: Session): Prisma.EmailChangeRequestWhereInput {
  if (session.user.isSuperAdmin) {
    return {};
  }

  return {
    servicePartnerId: session.user.servicePartnerId,
  };
}

async function assertEmailAvailable(newEmail: string, excludeUserId: string) {
  const existing = await prisma.user.findFirst({
    where: {
      email: newEmail,
      id: {
        not: excludeUserId,
      },
      deletedAt: null,
    },
    select: { id: true },
  });

  if (existing) {
    throw new Error("Email is already in use.");
  }
}

async function notifyEmailAddress(to: string, subject: string, lines: string[]) {
  return sendTransactionalEmail({
    to,
    subject,
    text: lines.join("\n"),
    html: `<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; white-space: pre-line;">${lines.join("\n")}</div>`,
  });
}

async function loadEmailChangeRequestForOtpById(requestId: string) {
  return prisma.emailChangeRequest.findUnique({
    where: { id: requestId },
    include: {
      user: {
        select: {
          id: true,
          servicePartnerId: true,
          name: true,
        },
      },
    },
  });
}

async function sendEmailChangeVerificationOtpForRequest(request: Awaited<ReturnType<typeof loadEmailChangeRequestForOtpById>>) {
  if (!request) {
    throw new Error("Email change request not found.");
  }

  if (
    request.status !== EmailChangeRequestStatus.APPROVED &&
    request.status !== EmailChangeRequestStatus.OTP_SENT
  ) {
    throw new Error("Email change request is not ready for verification.");
  }

  await assertEmailAvailable(request.newEmail, request.userId);

  const delivery = await sendOtpChallengeToKnownTarget({
    servicePartnerId: request.servicePartnerId,
    userId: request.userId,
    target: request.newEmail,
    purpose: OtpPurpose.EMAIL_CHANGE,
  });

  if (!delivery.ok) {
    throw new Error(delivery.message);
  }

  const expiresAt = new Date(Date.now() + env().OTP_EXPIRY_SECONDS * 1000);
  return prisma.emailChangeRequest.update({
    where: { id: request.id },
    data: {
      status: EmailChangeRequestStatus.OTP_SENT,
      expiresAt,
    },
  });
}

export async function listEmailChangeRequests(session: Session, input: { status?: EmailChangeRequestStatus; q?: string }) {
  const where: Prisma.EmailChangeRequestWhereInput = {
    ...getEmailChangeRequestScope(session),
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { oldEmail: { contains: q, mode: "insensitive" } },
      { newEmail: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
      { user: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  return prisma.emailChangeRequest.findMany({
    where,
    orderBy: [{ requestedAt: "desc" }],
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          servicePartnerId: true,
        },
      },
      reviewedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      servicePartner: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
  });
}

export async function getLatestEmailChangeRequestForUser(userId: string) {
  return prisma.emailChangeRequest.findFirst({
    where: { userId },
    orderBy: [{ requestedAt: "desc" }],
  });
}

export async function createEmailChangeRequest(session: Session, newEmailInput: string) {
  const newEmail = normalizeEmail(newEmailInput);
  const user = await prisma.user.findFirst({
    where: {
      id: session.user.id,
      deletedAt: null,
      status: "ACTIVE",
    },
    select: {
      id: true,
      servicePartnerId: true,
      email: true,
      name: true,
    },
  });

  if (!user?.email) {
    throw new Error("Current email is required before requesting a change.");
  }

  if (normalizeEmail(user.email) === newEmail) {
    throw new Error("New email must be different from the current email.");
  }

  await assertEmailAvailable(newEmail, user.id);

  const existingOpenRequest = await prisma.emailChangeRequest.findFirst({
    where: {
      userId: user.id,
      status: {
        in: [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED, EmailChangeRequestStatus.OTP_SENT],
      },
    },
    select: { id: true },
  });

  if (existingOpenRequest) {
    throw new Error("An email change request is already pending.");
  }

  const request = await prisma.emailChangeRequest.create({
    data: {
      userId: user.id,
      servicePartnerId: user.servicePartnerId,
      oldEmail: user.email,
      newEmail,
      status: EmailChangeRequestStatus.PENDING_APPROVAL,
    },
  });

  await notifyEmailAddress(user.email, "Matrix CRM email change requested", [
    `Hello ${user.name?.trim() || "User"},`,
    "",
    `A request was submitted to change your Matrix CRM email from ${user.email} to ${newEmail}.`,
    "If you did not request this change, contact your administrator immediately.",
  ]);

  return request;
}

export async function getEmailChangeRequestById(session: Session, requestId: string) {
  return prisma.emailChangeRequest.findFirst({
    where: {
      id: requestId,
      ...getEmailChangeRequestScope(session),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          servicePartnerId: true,
        },
      },
      reviewedBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function sendEmailChangeVerificationOtp(session: Session, requestId: string) {
  const request = await prisma.emailChangeRequest.findFirst({
    where: {
      id: requestId,
      userId: session.user.id,
      ...(isScopedToTenant(session) ? { servicePartnerId: session.user.servicePartnerId } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          servicePartnerId: true,
          name: true,
        },
      },
    },
  });

  return sendEmailChangeVerificationOtpForRequest(request);
}

export async function approveEmailChangeRequest(session: Session, requestId: string) {
  const request = await getEmailChangeRequestById(session, requestId);
  if (!request) {
    throw new Error("Email change request not found.");
  }

  if (request.status !== EmailChangeRequestStatus.PENDING_APPROVAL && request.status !== EmailChangeRequestStatus.APPROVED) {
    throw new Error("Only pending email change requests can be approved.");
  }

  await prisma.emailChangeRequest.update({
    where: { id: request.id },
    data: {
      status: EmailChangeRequestStatus.APPROVED,
      reviewedByUserId: session.user.id,
      reviewedAt: new Date(),
      rejectionReason: null,
    },
  });

  return sendEmailChangeVerificationOtpForRequest(await loadEmailChangeRequestForOtpById(request.id));
}

export async function rejectEmailChangeRequest(session: Session, requestId: string, rejectionReason?: string | null) {
  const request = await getEmailChangeRequestById(session, requestId);
  if (!request) {
    throw new Error("Email change request not found.");
  }

  if (
    request.status !== EmailChangeRequestStatus.PENDING_APPROVAL &&
    request.status !== EmailChangeRequestStatus.APPROVED &&
    request.status !== EmailChangeRequestStatus.OTP_SENT
  ) {
    throw new Error("Only open email change requests can be rejected.");
  }

  return prisma.emailChangeRequest.update({
    where: { id: request.id },
    data: {
      status: EmailChangeRequestStatus.REJECTED,
      reviewedByUserId: session.user.id,
      reviewedAt: new Date(),
      rejectionReason: rejectionReason?.trim() || null,
    },
  });
}

export async function verifyEmailChangeRequest(session: Session, requestId: string, code: string) {
  const request = await prisma.emailChangeRequest.findFirst({
    where: {
      id: requestId,
      userId: session.user.id,
      ...(isScopedToTenant(session) ? { servicePartnerId: session.user.servicePartnerId } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          servicePartnerId: true,
          name: true,
        },
      },
    },
  });

  if (!request) {
    throw new Error("Email change request not found.");
  }

  if (request.status !== EmailChangeRequestStatus.OTP_SENT && request.status !== EmailChangeRequestStatus.APPROVED) {
    throw new Error("Email change request is not awaiting OTP verification.");
  }

  if (request.expiresAt && request.expiresAt.getTime() < Date.now()) {
    await prisma.emailChangeRequest.update({
      where: { id: request.id },
      data: {
        status: EmailChangeRequestStatus.EXPIRED,
      },
    });
    throw new Error("Email change OTP has expired.");
  }

  await assertEmailAvailable(request.newEmail, request.userId);

  const verified = await verifyOtpForTarget({
    userId: request.userId,
    target: request.newEmail,
    purpose: OtpPurpose.EMAIL_CHANGE,
    code,
  });

  if (!verified.ok) {
    throw new Error(verified.message);
  }

  const verifiedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: request.userId },
      data: {
        email: request.newEmail,
        emailVerified: verifiedAt,
      },
    });

    await tx.emailChangeRequest.update({
      where: { id: request.id },
      data: {
        status: EmailChangeRequestStatus.VERIFIED,
        verifiedAt,
      },
    });

    await tx.emailChangeRequest.updateMany({
      where: {
        userId: request.userId,
        id: {
          not: request.id,
        },
        status: {
          in: [EmailChangeRequestStatus.PENDING_APPROVAL, EmailChangeRequestStatus.APPROVED, EmailChangeRequestStatus.OTP_SENT],
        },
      },
      data: {
        status: EmailChangeRequestStatus.CANCELLED,
      },
    });
  });

  if (request.oldEmail) {
    await notifyEmailAddress(request.oldEmail, "Matrix CRM email changed successfully", [
      `Hello ${request.user.name?.trim() || "User"},`,
      "",
      `Your Matrix CRM email has been changed from ${request.oldEmail} to ${request.newEmail}.`,
      "If you did not complete this verification, contact your administrator immediately.",
    ]);
  }

  return request;
}
