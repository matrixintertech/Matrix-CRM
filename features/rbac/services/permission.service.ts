import type { Session } from "next-auth";
import { Prisma } from "@prisma/client";

import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListPermissionsInput = {
  q?: string;
  module?: string;
  action?: string;
  page?: number;
  pageSize?: number;
};

function buildPermissionWhere(input: Omit<ListPermissionsInput, "page" | "pageSize">): Prisma.PermissionWhereInput {
  const where: Prisma.PermissionWhereInput = {};

  if (input.module?.trim()) {
    where.module = input.module.trim();
  }

  if (input.action?.trim()) {
    where.action = input.action.trim();
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

  return where;
}

function getRoleTenantWhere(session: Session): Prisma.RoleWhereInput {
  const where = scopeByTenant(session, {});
  if (session.user.isSuperAdmin) {
    return where;
  }

  return {
    ...where,
    scope: "TENANT",
  };
}

export async function listPermissions(_session: Session, input: ListPermissionsInput) {
  const pagination = getPagination(input);
  const where = buildPermissionWhere(input);

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

export async function listPermissionMatrix(_session: Session, input: Omit<ListPermissionsInput, "page" | "pageSize">) {
  const where = buildPermissionWhere(input);

  return prisma.permission.findMany({
    where,
    orderBy: [{ module: "asc" }, { key: "asc" }],
    select: {
      id: true,
      key: true,
      module: true,
      action: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getPermissionOverview(session: Session) {
  const [totalPermissions, distinctModules, rolesUsingPermissions, latestPermission, latestPermissionChange] = await Promise.all([
    prisma.permission.count(),
    prisma.permission.findMany({
      distinct: ["module"],
      select: {
        module: true,
      },
    }),
    prisma.role.count({
      where: {
        ...getRoleTenantWhere(session),
        deletedAt: null,
        permissions: {
          some: {},
        },
      },
    }),
    prisma.permission.findFirst({
      orderBy: [{ updatedAt: "desc" }],
      select: {
        updatedAt: true,
      },
    }),
    prisma.activityLog.findFirst({
      where: {
        ...scopeByTenant(session, {}),
        module: "roles",
        OR: [
          { action: { contains: "permission" } },
          { action: "role.create" },
          { action: "role.update" },
        ],
      },
      orderBy: [{ createdAt: "desc" }],
      select: {
        createdAt: true,
        actor: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  return {
    totalPermissions,
    modulesCovered: distinctModules.length,
    rolesUsingPermissions,
    recentlyUpdatedAt: latestPermissionChange?.createdAt ?? latestPermission?.updatedAt ?? null,
    recentlyUpdatedBy: latestPermissionChange?.actor?.name ?? latestPermissionChange?.actor?.email ?? "System",
  };
}

export async function listPermissionGroups(session: Session) {
  const roles = await prisma.role.findMany({
    where: {
      ...getRoleTenantWhere(session),
      deletedAt: null,
    },
    orderBy: [{ level: "desc" }, { permissions: { _count: "desc" } }, { name: "asc" }],
    take: 6,
    select: {
      id: true,
      name: true,
      key: true,
      level: true,
      scope: true,
      _count: {
        select: {
          permissions: true,
          users: true,
        },
      },
    },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    key: role.key,
    level: role.level,
    scope: role.scope,
    permissionCount: role._count.permissions,
    userCount: role._count.users,
  }));
}

export async function listRecentPermissionChanges(session: Session) {
  return prisma.activityLog.findMany({
    where: {
      ...scopeByTenant(session, {}),
      module: "roles",
      OR: [
        { action: { contains: "permission" } },
        { action: "role.create" },
        { action: "role.update" },
      ],
    },
    orderBy: [{ createdAt: "desc" }],
    take: 5,
    select: {
      id: true,
      action: true,
      message: true,
      createdAt: true,
      actor: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });
}

export async function listPermissionFilterOptions(_session: Session) {
  const [modules, actions] = await Promise.all([
    prisma.permission.findMany({
      distinct: ["module"],
      orderBy: [{ module: "asc" }],
      select: {
        module: true,
      },
    }),
    prisma.permission.findMany({
      distinct: ["action"],
      orderBy: [{ action: "asc" }],
      select: {
        action: true,
      },
    }),
  ]);

  return {
    modules: modules.map((entry) => entry.module),
    actions: actions.map((entry) => entry.action),
  };
}
