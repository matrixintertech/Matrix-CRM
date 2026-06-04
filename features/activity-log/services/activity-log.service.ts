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
