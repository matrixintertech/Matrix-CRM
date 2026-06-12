import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListActivityLogsInput = {
  q?: string;
  actorUserId?: string;
  action?: string;
  module?: string;
  dateFrom?: Date;
  dateTo?: Date;
  page?: number;
  pageSize?: number;
};

function buildActivityLogWhere(session: Session, input: Omit<ListActivityLogsInput, "page" | "pageSize">): Prisma.ActivityLogWhereInput {
  const where: Prisma.ActivityLogWhereInput = {
    ...scopeByTenant(session, {}),
  };

  if (input.actorUserId?.trim()) {
    where.actorUserId = input.actorUserId.trim();
  }
  if (input.action?.trim()) {
    where.action = input.action.trim();
  }
  if (input.module?.trim()) {
    where.module = input.module.trim();
  }
  if (input.dateFrom || input.dateTo) {
    where.createdAt = {};
    if (input.dateFrom) {
      where.createdAt.gte = startOfDay(input.dateFrom);
    }
    if (input.dateTo) {
      where.createdAt.lte = endOfDay(input.dateTo);
    }
  }
  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { module: { contains: q, mode: "insensitive" } },
      { message: { contains: q, mode: "insensitive" } },
      { entityId: { contains: q, mode: "insensitive" } },
      { actor: { name: { contains: q, mode: "insensitive" } } },
      { actor: { email: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
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

export async function listActivityLogs(session: Session, input: ListActivityLogsInput) {
  const pagination = getPagination(input);
  const where = buildActivityLogWhere(session, input);

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
      include: {
        actor: {
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
    }),
    prisma.activityLog.count({ where }),
  ]);

  return {
    logs,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getActivityLogOverview(session: Session, input: Omit<ListActivityLogsInput, "page" | "pageSize">) {
  const where = buildActivityLogWhere(session, input);
  const [totalLogs, latestLog, moduleGroups, actionGroups, actorGroups] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findFirst({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: { createdAt: true },
    }),
    prisma.activityLog.groupBy({
      by: ["module"],
      where,
      _count: { _all: true },
      orderBy: { _count: { module: "desc" } },
      take: 5,
    }),
    prisma.activityLog.groupBy({
      by: ["action"],
      where,
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
      take: 5,
    }),
    prisma.activityLog.groupBy({
      by: ["actorUserId"],
      where: {
        ...where,
        actorUserId: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { actorUserId: "desc" } },
      take: 5,
    }),
  ]);

  const actorIds = actorGroups
    .map((group) => group.actorUserId)
    .filter((actorUserId): actorUserId is string => Boolean(actorUserId));
  const actors =
    actorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: {
            id: true,
            name: true,
            email: true,
          },
        })
      : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  return {
    totalLogs,
    latestCreatedAt: latestLog?.createdAt ?? null,
    moduleBreakdown: moduleGroups.map((group) => ({
      key: group.module,
      label: group.module,
      count: group._count._all,
    })),
    actionBreakdown: actionGroups.map((group) => ({
      key: group.action,
      label: group.action,
      count: group._count._all,
    })),
    actorBreakdown: actorGroups
      .map((group) => {
        if (!group.actorUserId) {
          return null;
        }
        const actor = actorById.get(group.actorUserId);
        return {
          key: group.actorUserId,
          label: actor?.name?.trim() || actor?.email || group.actorUserId,
          count: group._count._all,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
  };
}
