import type { Session } from "next-auth";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListPermissionsInput = {
  q?: string;
  module?: string;
  page?: number;
  pageSize?: number;
};

export async function listPermissions(_session: Session, input: ListPermissionsInput) {
  const pagination = getPagination(input);
  const where: Prisma.PermissionWhereInput = {};

  if (input.module?.trim()) {
    where.module = input.module.trim();
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { key: { contains: q, mode: "insensitive" } },
      { module: { contains: q, mode: "insensitive" } },
      { action: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const [permissions, total] = await Promise.all([
    prisma.permission.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ module: "asc" }, { key: "asc" }],
    }),
    prisma.permission.count({ where }),
  ]);

  return {
    permissions,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}
