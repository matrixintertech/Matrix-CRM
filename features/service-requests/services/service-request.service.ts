import { Prisma, type ServiceRequestStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ServiceRequestStatusInput, ServiceRequestUpsertInput } from "@/features/service-requests/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListServiceRequestsInput = {
  q?: string;
  status?: ServiceRequestStatus;
  clientId?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getServiceRequestScopeWhere(session: Session): Prisma.ServiceRequestWhereInput {
  return scopeByTenant(session, {});
}

export async function listServiceRequests(session: Session, input: ListServiceRequestsInput) {
  const pagination = getPagination(input);
  const where: Prisma.ServiceRequestWhereInput = {
    ...getServiceRequestScopeWhere(session),
    deletedAt: null,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.clientId?.trim()) {
    where.clientId = input.clientId;
  }

  if (input.branchId?.trim()) {
    where.branchId = input.branchId;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { serviceNumber: { contains: q, mode: "insensitive" } },
      { title: { contains: q, mode: "insensitive" } },
      { serviceType: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
      { client: { code: { contains: q, mode: "insensitive" } } },
      { branch: { name: { contains: q, mode: "insensitive" } } },
      { branch: { code: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [serviceRequests, total] = await Promise.all([
    prisma.serviceRequest.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
      include: {
        servicePartner: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        client: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        branch: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        _count: {
          select: {
            statusHistory: true,
          },
        },
      },
    }),
    prisma.serviceRequest.count({ where }),
  ]);

  return {
    serviceRequests,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getServiceRequestById(session: Session, id: string) {
  return prisma.serviceRequest.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getServiceRequestScopeWhere(session),
    },
    include: {
      servicePartner: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      client: {
        select: {
          id: true,
          code: true,
          name: true,
          servicePartnerId: true,
        },
      },
      branch: {
        select: {
          id: true,
          code: true,
          name: true,
          clientId: true,
          servicePartnerId: true,
        },
      },
      createdByUser: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      statusHistory: {
        orderBy: [{ changedAt: "desc" }],
        include: {
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      },
    },
  });
}

export async function listServiceRequestServicePartnersForForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return prisma.servicePartner.findMany({
      where: {
        id: session.user.servicePartnerId,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
      },
    });
  }

  return prisma.servicePartner.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
    },
  });
}

export async function listClientsForServiceRequestForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;
  return prisma.client.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      servicePartnerId: true,
    },
  });
}

export async function listBranchesForServiceRequestForm(
  session: Session,
  servicePartnerId?: string,
  clientId?: string
) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.branch.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...(clientId ? { clientId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      clientId: true,
      servicePartnerId: true,
    },
  });
}

export function getServicePartnerIdForServiceRequestWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

async function assertServiceRequestTenantConsistency(clientId: string, branchId: string | undefined, servicePartnerId: string) {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });

  if (!client) {
    throw new Error("Client not found.");
  }

  if (client.servicePartnerId !== servicePartnerId) {
    throw new Error("Client and service partner mismatch.");
  }

  if (!branchId) {
    return;
  }

  const branch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      deletedAt: null,
    },
    select: {
      id: true,
      clientId: true,
      servicePartnerId: true,
    },
  });

  if (!branch) {
    throw new Error("Branch not found.");
  }

  if (branch.clientId !== client.id) {
    throw new Error("Branch and client mismatch.");
  }

  if (branch.servicePartnerId !== servicePartnerId) {
    throw new Error("Branch and service partner mismatch.");
  }
}

function toYyyyMmDd(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function generateServiceNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `SR-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.serviceRequest.findFirst({
      where: {
        servicePartnerId,
        serviceNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique service number.");
}

export async function createServiceRequest(session: Session, input: ServiceRequestUpsertInput) {
  const servicePartnerId = getServicePartnerIdForServiceRequestWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertServiceRequestTenantConsistency(input.clientId, input.branchId, servicePartnerId);

  const requestedNumber = input.serviceNumber?.trim().toUpperCase();
  const maxAttempts = requestedNumber ? 1 : 5;

  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const serviceNumber = requestedNumber || (await generateServiceNumber(servicePartnerId));

    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.serviceRequest.create({
          data: {
            servicePartnerId,
            clientId: input.clientId,
            branchId: input.branchId ?? null,
            createdByUserId: session.user.id,
            serviceNumber,
            title: input.title.trim(),
            description: normalizeOptionalString(input.description),
            serviceType: input.serviceType.trim(),
            status: input.status,
            requestedAt: input.requestedAt ?? null,
            targetDate: input.targetDate ?? null,
          },
        });

        await tx.serviceRequestStatusHistory.create({
          data: {
            serviceRequestId: created.id,
            fromStatus: null,
            toStatus: created.status,
            remarks: "Created",
            changedByUserId: session.user.id,
          },
        });

        return created;
      });
    } catch (error) {
      lastError = error;
      const isUniqueError =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        String(error.meta?.target ?? "").includes("serviceNumber");

      if (requestedNumber || !isUniqueError) {
        throw error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error("Unable to create service request.");
}

export async function updateServiceRequest(session: Session, id: string, input: ServiceRequestUpsertInput) {
  const existing = await getServiceRequestById(session, id);
  if (!existing) {
    throw new Error("Service request not found.");
  }

  const servicePartnerId = getServicePartnerIdForServiceRequestWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertServiceRequestTenantConsistency(input.clientId, input.branchId, servicePartnerId);

  return prisma.serviceRequest.update({
    where: { id },
    data: {
      servicePartnerId,
      clientId: input.clientId,
      branchId: input.branchId ?? null,
      title: input.title.trim(),
      description: normalizeOptionalString(input.description),
      serviceType: input.serviceType.trim(),
      requestedAt: input.requestedAt ?? null,
      targetDate: input.targetDate ?? null,
    },
  });
}

export async function updateServiceRequestStatus(
  session: Session,
  id: string,
  input: ServiceRequestStatusInput
) {
  const existing = await getServiceRequestById(session, id);
  if (!existing) {
    throw new Error("Service request not found.");
  }

  return prisma.$transaction(async (tx) => {
    const nextCompletedAt =
      input.status === "COMPLETED" || input.status === "CLOSED"
        ? existing.completedAt ?? new Date()
        : input.status === "RAISED" || input.status === "TRIAGED" || input.status === "IN_PROGRESS" || input.status === "BLOCKED"
          ? null
          : existing.completedAt;

    const updated = await tx.serviceRequest.update({
      where: { id },
      data: {
        status: input.status,
        completedAt: nextCompletedAt,
      },
    });

    await tx.serviceRequestStatusHistory.create({
      data: {
        serviceRequestId: id,
        fromStatus: existing.status,
        toStatus: input.status,
        remarks: normalizeOptionalString(input.remarks),
        changedByUserId: session.user.id,
      },
    });

    return updated;
  });
}

export async function softDeleteServiceRequest(id: string) {
  return prisma.serviceRequest.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
}
