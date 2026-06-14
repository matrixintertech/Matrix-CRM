import { Prisma, type ServiceRequestStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ServiceRequestStatusInput, ServiceRequestUpsertInput } from "@/features/service-requests/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { measurePerf } from "@/lib/observability/perf";

export type ServiceRequestStatusGroup = "open" | "in_progress" | "resolved" | "closed" | "overdue";
export type ServiceRequestPriority = "high" | "medium" | "low";

type ListServiceRequestsInput = {
  q?: string;
  status?: ServiceRequestStatus;
  statusGroup?: ServiceRequestStatusGroup;
  priority?: ServiceRequestPriority;
  clientId?: string;
  branchId?: string;
  servicePartnerId?: string;
  page?: number;
  pageSize?: number;
};

type ServiceRequestFilterInput = Omit<ListServiceRequestsInput, "page" | "pageSize" | "statusGroup" | "priority">;

const OPEN_STATUSES = [
  "DRAFT",
  "RAISED",
  "TRIAGED",
  "PM_ASSIGNED",
  "SM_ASSIGNED",
  "QUOTE_PREPARING",
  "QUOTE_SUBMITTED",
  "QUOTE_APPROVED",
  "QUOTE_REJECTED",
] as const satisfies ServiceRequestStatus[];

const IN_PROGRESS_STATUSES = ["IN_PROGRESS", "BLOCKED"] as const satisfies ServiceRequestStatus[];
const RESOLVED_STATUSES = ["COMPLETED"] as const satisfies ServiceRequestStatus[];
const CLOSED_STATUSES = ["CLOSED", "CANCELLED"] as const satisfies ServiceRequestStatus[];
const CLOSED_LIKE_STATUSES: ServiceRequestStatus[] = [...RESOLVED_STATUSES, ...CLOSED_STATUSES];

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getServiceRequestScopeWhere(session: Session): Prisma.ServiceRequestWhereInput {
  return scopeByTenant(session, {});
}

function buildServiceRequestWhere(session: Session, input: ServiceRequestFilterInput): Prisma.ServiceRequestWhereInput {
  const where: Prisma.ServiceRequestWhereInput = {
    ...getServiceRequestScopeWhere(session),
    deletedAt: null,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.clientId?.trim()) {
    where.clientId = input.clientId.trim();
  }

  if (input.branchId?.trim()) {
    where.branchId = input.branchId.trim();
  }

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
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
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function getStatusGroup(status: ServiceRequestStatus): ServiceRequestStatusGroup {
  if ((OPEN_STATUSES as readonly ServiceRequestStatus[]).includes(status)) {
    return "open";
  }
  if ((IN_PROGRESS_STATUSES as readonly ServiceRequestStatus[]).includes(status)) {
    return "in_progress";
  }
  if ((RESOLVED_STATUSES as readonly ServiceRequestStatus[]).includes(status)) {
    return "resolved";
  }
  return "closed";
}

function isClosedLike(status: ServiceRequestStatus) {
  return (RESOLVED_STATUSES as readonly ServiceRequestStatus[]).includes(status) || (CLOSED_STATUSES as readonly ServiceRequestStatus[]).includes(status);
}

function isOverdue(record: { status: ServiceRequestStatus; targetDate: Date | null }) {
  if (!record.targetDate) {
    return false;
  }
  if (isClosedLike(record.status)) {
    return false;
  }
  return record.targetDate.getTime() < Date.now();
}

function getPriority(record: { status: ServiceRequestStatus; targetDate: Date | null }) {
  if (isOverdue(record)) {
    return "high" as const;
  }

  if (record.targetDate) {
    const diffDays = (record.targetDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 1) {
      return "high" as const;
    }
    if (diffDays <= 3) {
      return "medium" as const;
    }
  }

  if ((IN_PROGRESS_STATUSES as readonly ServiceRequestStatus[]).includes(record.status)) {
    return "medium" as const;
  }

  return "low" as const;
}

function matchesDerivedFilters(
  record: { status: ServiceRequestStatus; targetDate: Date | null },
  statusGroup?: ServiceRequestStatusGroup,
  priority?: ServiceRequestPriority
) {
  if (statusGroup) {
    if (statusGroup === "overdue") {
      if (!isOverdue(record)) {
        return false;
      }
    } else if (getStatusGroup(record.status) !== statusGroup) {
      return false;
    }
  }

  if (priority && getPriority(record) !== priority) {
    return false;
  }

  return true;
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function combineServiceRequestWhere(
  ...conditions: Array<Prisma.ServiceRequestWhereInput | undefined>
): Prisma.ServiceRequestWhereInput {
  const filtered = conditions.filter((condition): condition is Prisma.ServiceRequestWhereInput => Boolean(condition));
  if (filtered.length === 0) {
    return {};
  }
  if (filtered.length === 1) {
    return filtered[0]!;
  }
  return {
    AND: filtered,
  };
}

function buildServiceRequestStatusGroupWhere(statusGroup: ServiceRequestStatusGroup | undefined, now: Date) {
  if (!statusGroup) {
    return undefined;
  }

  if (statusGroup === "open") {
    return {
      status: {
        in: [...OPEN_STATUSES],
      },
    } satisfies Prisma.ServiceRequestWhereInput;
  }

  if (statusGroup === "in_progress") {
    return {
      status: {
        in: [...IN_PROGRESS_STATUSES],
      },
    } satisfies Prisma.ServiceRequestWhereInput;
  }

  if (statusGroup === "resolved") {
    return {
      status: {
        in: [...RESOLVED_STATUSES],
      },
    } satisfies Prisma.ServiceRequestWhereInput;
  }

  if (statusGroup === "closed") {
    return {
      status: {
        in: [...CLOSED_STATUSES],
      },
    } satisfies Prisma.ServiceRequestWhereInput;
  }

  return {
    targetDate: {
      lt: now,
    },
    NOT: {
      status: {
        in: CLOSED_LIKE_STATUSES,
      },
    },
  } satisfies Prisma.ServiceRequestWhereInput;
}

function buildHighPriorityWhere(highThreshold: Date) {
  return {
    targetDate: {
      lte: highThreshold,
    },
  } satisfies Prisma.ServiceRequestWhereInput;
}

function buildMediumPriorityWhere(highThreshold: Date, mediumThreshold: Date) {
  return {
    AND: [
      {
        NOT: buildHighPriorityWhere(highThreshold),
      },
      {
        OR: [
          {
            status: {
              in: [...IN_PROGRESS_STATUSES],
            },
          },
          {
            targetDate: {
              lte: mediumThreshold,
            },
          },
        ],
      },
    ],
  } satisfies Prisma.ServiceRequestWhereInput;
}

function getServiceRequestListSelect() {
  return {
    id: true,
    serviceNumber: true,
    title: true,
    serviceType: true,
    status: true,
    requestedAt: true,
    targetDate: true,
    completedAt: true,
    createdAt: true,
    updatedAt: true,
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
    servicePartner: {
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
  } satisfies Prisma.ServiceRequestSelect;
}

async function fetchServiceRequestsBaseByWhere(where: Prisma.ServiceRequestWhereInput) {
  return prisma.serviceRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: getServiceRequestListSelect(),
  });
}

async function fetchServiceRequestsBase(session: Session, input: ServiceRequestFilterInput, statusGroup?: ServiceRequestStatusGroup) {
  const now = new Date();
  const where = combineServiceRequestWhere(
    buildServiceRequestWhere(session, input),
    buildServiceRequestStatusGroupWhere(statusGroup, now)
  );
  return fetchServiceRequestsBaseByWhere(where);
}

function enrichServiceRequestRow<
  T extends {
    status: ServiceRequestStatus;
    targetDate: Date | null;
    requestedAt: Date | null;
    createdAt: Date;
  },
>(row: T) {
  return {
    ...row,
    derived: {
      statusGroup: getStatusGroup(row.status),
      priority: getPriority(row),
      overdue: isOverdue(row),
      requestDate: row.requestedAt ?? row.createdAt,
    },
  };
}

export async function listServiceRequests(session: Session, input: ListServiceRequestsInput) {
  return measurePerf("service_requests.list", async () => {
    const pagination = getPagination(input);
    const now = new Date();
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        statusGroup: input.statusGroup ?? null,
        priority: input.priority ?? null,
        clientId: input.clientId?.trim() || null,
        branchId: input.branchId?.trim() || null,
        servicePartnerId: input.servicePartnerId?.trim() || null,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");

    const loadServiceRequests = async () => {
      const baseWhere = buildServiceRequestWhere(session, input);
      const derivedWhere = buildServiceRequestStatusGroupWhere(input.statusGroup, now);

      if (!input.priority) {
        const where = combineServiceRequestWhere(baseWhere, derivedWhere);
        const [rows, total] = await Promise.all([
          prisma.serviceRequest.findMany({
            where,
            skip: pagination.skip,
            take: pagination.take,
            orderBy: [{ createdAt: "desc" }],
            select: getServiceRequestListSelect(),
          }),
          prisma.serviceRequest.count({ where }),
        ]);

        return {
          serviceRequests: rows.map(enrichServiceRequestRow),
          total,
          page: pagination.page,
          pageSize: pagination.pageSize,
          totalPages: getTotalPages(total, pagination.pageSize),
        };
      }

      const rows = await fetchServiceRequestsBaseByWhere(combineServiceRequestWhere(baseWhere, derivedWhere));
      const enriched = rows.map(enrichServiceRequestRow);
      const filtered = enriched.filter((row) => matchesDerivedFilters(row, input.statusGroup, input.priority));
      const paged = filtered.slice(pagination.skip, pagination.skip + pagination.take);

      return {
        serviceRequests: paged,
        total: filtered.length,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: getTotalPages(filtered.length, pagination.pageSize),
      };
    };

    if (pagination.page === 1) {
      return getOrSetServerCache("service_requests.list", cacheKey, loadServiceRequests, {
        ttlSeconds: 20,
        prefixes: [cachePrefixes.serviceRequests, `${cachePrefixes.serviceRequests}:tenant:${session.user.servicePartnerId}`],
      });
    }

    return loadServiceRequests();
  });
}

export async function getServiceRequestOverview(session: Session, input: ServiceRequestFilterInput) {
  const now = new Date();
  const highThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const mediumThreshold = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const where = buildServiceRequestWhere(session, input);

  const [
    totalRequests,
    openRequests,
    inProgressRequests,
    resolvedRequests,
    closedRequests,
    overdueRequests,
    highPriorityRequests,
    mediumPriorityRequests,
    latestUpdatedRequest,
    resolutionRows,
  ] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildServiceRequestStatusGroupWhere("open", now)),
    }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildServiceRequestStatusGroupWhere("in_progress", now)),
    }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildServiceRequestStatusGroupWhere("resolved", now)),
    }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildServiceRequestStatusGroupWhere("closed", now)),
    }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildServiceRequestStatusGroupWhere("overdue", now)),
    }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildHighPriorityWhere(highThreshold)),
    }),
    prisma.serviceRequest.count({
      where: combineServiceRequestWhere(where, buildMediumPriorityWhere(highThreshold, mediumThreshold)),
    }),
    prisma.serviceRequest.findFirst({
      where,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        updatedAt: true,
      },
    }),
    prisma.serviceRequest.findMany({
      where: combineServiceRequestWhere(where, {
        status: {
          in: CLOSED_LIKE_STATUSES,
        },
        completedAt: {
          not: null,
        },
      }),
      select: {
        requestedAt: true,
        createdAt: true,
        completedAt: true,
      },
    }),
  ]);

  const latestUpdatedAt = latestUpdatedRequest?.updatedAt ?? null;
  const resolutionDurations = resolutionRows.map((row) => {
    const start = row.requestedAt ?? row.createdAt;
    return Math.max((row.completedAt!.getTime() - start.getTime()) / (1000 * 60 * 60 * 24), 0);
  });
  const avgResolutionDays =
    resolutionDurations.length > 0 ? resolutionDurations.reduce((sum, value) => sum + value, 0) / resolutionDurations.length : null;
  const lowPriorityRequests = Math.max(totalRequests - highPriorityRequests - mediumPriorityRequests, 0);

  return {
    totalRequests,
    openRequests,
    inProgressRequests,
    resolvedRequests,
    closedRequests,
    overdueRequests,
    latestUpdatedAt,
    avgResolutionDays,
    statusBreakdown: [
      { key: "open", label: "Open", count: openRequests, color: "#3f66ff" },
      { key: "in_progress", label: "In Progress", count: inProgressRequests, color: "#ffab1f" },
      { key: "resolved", label: "Resolved", count: resolvedRequests, color: "#28b463" },
      { key: "closed", label: "Closed", count: closedRequests, color: "#9aa8bf" },
    ],
    priorityBreakdown: [
      { key: "high", label: "High", count: highPriorityRequests, color: "#ff4f5e" },
      { key: "medium", label: "Medium", count: mediumPriorityRequests, color: "#ffab1f" },
      { key: "low", label: "Low", count: lowPriorityRequests, color: "#28b463" },
    ],
  };
}

export async function listRecentOverdueServiceRequests(session: Session, input: ServiceRequestFilterInput) {
  const now = new Date();
  const rows = await prisma.serviceRequest.findMany({
    where: combineServiceRequestWhere(buildServiceRequestWhere(session, input), buildServiceRequestStatusGroupWhere("overdue", now)),
    orderBy: [{ targetDate: "asc" }, { createdAt: "desc" }],
    take: 5,
    select: getServiceRequestListSelect(),
  });

  return rows.map(enrichServiceRequestRow);
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
  return getOrSetServerCache(
    "options.service_request_clients",
    `${session.user.id}:${resolvedServicePartnerId ?? "all"}`,
    () =>
      prisma.client.findMany({
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
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
}

export async function listBranchesForServiceRequestForm(
  session: Session,
  servicePartnerId?: string,
  clientId?: string
) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return getOrSetServerCache(
    "options.service_request_branches",
    `${session.user.id}:${resolvedServicePartnerId ?? "all"}:${clientId ?? "all"}`,
    () =>
      prisma.branch.findMany({
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
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
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
      const created = await prisma.$transaction(async (tx) => {
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
      await invalidateTenantDataCaches(servicePartnerId);
      return created;
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

  const updated = await prisma.serviceRequest.update({
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

  await invalidateTenantDataCaches(servicePartnerId);
  return updated;
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

  const updated = await prisma.$transaction(async (tx) => {
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

  await invalidateTenantDataCaches(existing.servicePartnerId);
  return updated;
}

export async function softDeleteServiceRequest(id: string) {
  const deleted = await prisma.serviceRequest.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });

  await invalidateTenantDataCaches(deleted.servicePartnerId);
  return deleted;
}
