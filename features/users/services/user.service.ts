import { Prisma, UserStatus } from "@prisma/client";
import type { Session } from "next-auth";

import { getUserPermissions, invalidateAuthorizationCaches, isPlatformOnlyPermissionKey } from "@/lib/auth/permissions";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { scopeByTenant } from "@/lib/auth/tenant";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db/prisma";
import type { UserUpsertInput } from "@/features/users/validations";
import type { ExportRow } from "@/lib/export/csv";
import { measurePerf } from "@/lib/observability/perf";

type ListUsersInput = {
  q?: string;
  status?: UserStatus;
  servicePartnerId?: string;
  roleKey?: string;
  dateRange?: UserManagementDateRangePreset;
  page?: number;
  pageSize?: number;
};

export const USER_MANAGEMENT_DATE_RANGE_PRESETS = ["all", "30d", "90d", "year"] as const;

export type UserManagementDateRangePreset = (typeof USER_MANAGEMENT_DATE_RANGE_PRESETS)[number];

type BuildUserWhereOptions = {
  includeStatus?: boolean;
  includeQuery?: boolean;
};

type ExportUsersInput = Omit<ListUsersInput, "page" | "pageSize">;

export type AssignablePermission = {
  id: string;
  key: string;
  module: string;
  action: string;
  description: string | null;
};

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || null;
}

export function normalizePhone(phone?: string | null) {
  return phone?.trim() || null;
}

export function getUserTenantWhere(session: Session): Prisma.UserWhereInput {
  return scopeByTenant(session, {});
}

export function normalizeUserManagementDateRange(value?: string): UserManagementDateRangePreset {
  if (!value) {
    return "all";
  }

  return USER_MANAGEMENT_DATE_RANGE_PRESETS.includes(value as UserManagementDateRangePreset)
    ? (value as UserManagementDateRangePreset)
    : "all";
}

function resolveUserCreatedAtFilter(dateRange?: UserManagementDateRangePreset): Prisma.DateTimeFilter | undefined {
  const normalized = normalizeUserManagementDateRange(dateRange);
  if (normalized === "all") {
    return undefined;
  }

  const now = new Date();

  if (normalized === "year") {
    return {
      gte: new Date(now.getFullYear(), 0, 1),
      lte: now,
    };
  }

  const days = normalized === "30d" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);

  return {
    gte: from,
    lte: now,
  };
}

function buildUserWhere(session: Session, input: ListUsersInput, options: BuildUserWhereOptions = {}): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    ...getUserTenantWhere(session),
    deletedAt: null,
  };

  if (session.user.isSuperAdmin && input.servicePartnerId) {
    where.servicePartnerId = input.servicePartnerId;
  }

  if (options.includeStatus !== false && input.status) {
    where.status = input.status;
  }

  const createdAtFilter = resolveUserCreatedAtFilter(input.dateRange);
  if (createdAtFilter) {
    where.createdAt = createdAtFilter;
  }

  if (input.roleKey?.trim()) {
    where.roles = {
      some: {
        role: {
          key: input.roleKey.trim(),
          deletedAt: null,
        },
      },
    };
  }

  if (options.includeQuery !== false && input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

function toIsoString(value: Date | null | undefined) {
  return value ? value.toISOString() : "";
}

export async function listUsers(session: Session, input: ListUsersInput) {
  return measurePerf("users.list", async () => {
    const pagination = getPagination(input);
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        servicePartnerId: input.servicePartnerId ?? null,
        roleKey: input.roleKey?.trim() || null,
        dateRange: normalizeUserManagementDateRange(input.dateRange),
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");
    const where = buildUserWhere(session, input);

    const loadUsers = async () => {
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
            servicePartner: {
              select: {
                name: true,
                code: true,
              },
            },
          },
        }),
        prisma.user.count({ where }),
      ]);

      const userIds = users.map((user) => user.id);

      const userRoles = userIds.length > 0
        ? await prisma.userRole.findMany({
            where: {
              userId: {
                in: userIds,
              },
              role: {
                deletedAt: null,
              },
            },
            select: {
              userId: true,
              role: {
                select: {
                  key: true,
                  name: true,
                  level: true,
                },
              },
            },
          })
        : [];
      const userRolesMap = userRoles.reduce<Map<string, Array<{ role: { key: string; name: string; level: number } }>>>((map, entry) => {
        const roles = map.get(entry.userId);
        if (roles) {
          roles.push({ role: entry.role });
        } else {
          map.set(entry.userId, [{ role: entry.role }]);
        }
        return map;
      }, new Map());

      return {
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          status: user.status,
          lastLoginAt: user.lastLoginAt,
          createdAt: user.createdAt,
          servicePartner: user.servicePartner ?? { name: "-", code: "-" },
          roles: (userRolesMap.get(user.id) ?? []).sort(
            (left, right) => right.role.level - left.role.level || left.role.name.localeCompare(right.role.name)
          ),
        })),
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: getTotalPages(total, pagination.pageSize),
      };
    };

    if (pagination.page === 1) {
      return getOrSetServerCache("users.list", cacheKey, loadUsers, {
        ttlSeconds: 20,
        prefixes: [cachePrefixes.users, `${cachePrefixes.users}:tenant:${session.user.servicePartnerId}`],
      });
    }

    return loadUsers();
  });
}

export async function getUserManagementOverview(session: Session, input: Omit<ListUsersInput, "page" | "pageSize" | "q" | "status">) {
  return measurePerf("users.overview", async () => {
    const baseWhere = buildUserWhere(session, input, { includeQuery: false, includeStatus: false });

    const [totalUsers, activeUsers, pendingInvites, inactiveUsers, coveredCompanies] = await Promise.all([
      prisma.user.count({ where: baseWhere }),
      prisma.user.count({ where: { ...baseWhere, status: UserStatus.ACTIVE } }),
      prisma.user.count({
        where: {
          ...baseWhere,
          lastLoginAt: null,
          status: {
            not: UserStatus.INACTIVE,
          },
        },
      }),
      prisma.user.count({ where: { ...baseWhere, status: UserStatus.INACTIVE } }),
      prisma.user.findMany({
        where: baseWhere,
        distinct: ["servicePartnerId"],
        select: {
          servicePartnerId: true,
        },
      }),
    ]);

    return {
      totalUsers,
      activeUsers,
      pendingInvites,
      inactiveUsers,
      companiesCovered: coveredCompanies.length,
    };
  });
}

export async function exportUsers(session: Session, input: ExportUsersInput): Promise<ExportRow[]> {
  return measurePerf("users.export", async () => {
    const where = buildUserWhere(session, input);
    const users = await prisma.user.findMany({
      where,
      take: 5000,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        lastLoginAt: true,
        createdAt: true,
        servicePartner: {
          select: {
            name: true,
            code: true,
          },
        },
      },
    });

    const userIds = users.map((user) => user.id);
    const userRoles = userIds.length > 0
      ? await prisma.userRole.findMany({
          where: {
            userId: {
              in: userIds,
            },
            role: {
              deletedAt: null,
            },
          },
          select: {
            userId: true,
            role: {
              select: {
                key: true,
                name: true,
                level: true,
              },
            },
          },
        })
      : [];

    const userRolesMap = userRoles.reduce<Map<string, Array<{ role: { key: string; name: string; level: number } }>>>((map, entry) => {
      const roles = map.get(entry.userId);
      if (roles) {
        roles.push({ role: entry.role });
      } else {
        map.set(entry.userId, [{ role: entry.role }]);
      }
      return map;
    }, new Map());

    return users.map((user) => {
      const roles = (userRolesMap.get(user.id) ?? []).sort(
        (left, right) => right.role.level - left.role.level || left.role.name.localeCompare(right.role.name)
      );

      return {
        name: user.name ?? "",
        email: user.email ?? "",
        phone: user.phone ?? "",
        status: user.status,
        primaryRole: roles[0]?.role.name ?? "",
        roles: roles.map((entry) => entry.role.name).join(", "),
        company: user.servicePartner?.name ?? "",
        companyCode: user.servicePartner?.code ?? "",
        lastLoginAt: toIsoString(user.lastLoginAt),
        createdAt: toIsoString(user.createdAt),
      };
    });
  });
}

export async function getUserById(session: Session, id: string) {
  return prisma.user.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getUserTenantWhere(session),
    },
    include: {
      servicePartner: { select: { id: true, name: true, code: true } },
      roles: {
        include: {
          role: {
            include: {
              permissions: {
                include: {
                  permission: true,
                },
                orderBy: {
                  permission: {
                    key: "asc",
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function listAssignableRoles(session: Session) {
  return prisma.role.findMany({
    where: {
      deletedAt: null,
      ...(session.user.isSuperAdmin ? {} : { servicePartnerId: session.user.servicePartnerId }),
      ...(session.user.isSuperAdmin ? {} : { scope: "TENANT" }),
    },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
    include: { servicePartner: { select: { name: true, code: true } } },
  });
}

export async function listServicePartnersForUserForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return getOrSetServerCache(
      "options.service_partners",
      `${session.user.servicePartnerId}:self`,
      () =>
        prisma.servicePartner.findMany({
          where: { id: session.user.servicePartnerId },
          orderBy: { name: "asc" },
          select: { id: true, name: true, legalName: true, code: true },
        }),
      {
        ttlSeconds: 60,
        prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
      }
    );
  }

  return getOrSetServerCache(
    "options.service_partners",
    "super_admin",
    () =>
      prisma.servicePartner.findMany({
        where: { deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, legalName: true, code: true },
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, cachePrefixes.servicePartners],
    }
  );
}

export async function listAssignablePermissions(session: Session): Promise<AssignablePermission[]> {
  if (session.user.isSuperAdmin) {
    return prisma.permission.findMany({
      orderBy: [{ module: "asc" }, { key: "asc" }],
      select: {
        id: true,
        key: true,
        module: true,
        action: true,
        description: true,
      },
    });
  }

  const ownPermissionKeys = await getUserPermissions(session.user.id, session.user.roleKeys);
  if (ownPermissionKeys.length === 0) {
    return [];
  }

  const permissions = await prisma.permission.findMany({
    where: {
      key: {
        in: ownPermissionKeys,
      },
    },
    orderBy: [{ module: "asc" }, { key: "asc" }],
    select: {
      id: true,
      key: true,
      module: true,
      action: true,
      description: true,
    },
  });

  return permissions.filter((permission) => !isPlatformOnlyPermissionKey(permission.key));
}

export async function getPermissionKeysForRoleIds(roleIds: string[]) {
  const dedupedRoleIds = Array.from(new Set(roleIds));
  if (dedupedRoleIds.length === 0) {
    return [];
  }

  const rows = await prisma.rolePermission.findMany({
    where: {
      roleId: {
        in: dedupedRoleIds,
      },
    },
    select: {
      permission: {
        select: {
          key: true,
        },
      },
    },
  });

  return Array.from(new Set(rows.map((row) => row.permission.key)));
}

export async function syncUserRoles(session: Session, input: {
  userId: string;
  servicePartnerId: string;
  roleIds: string[];
}) {
  const dedupedRoleIds = Array.from(new Set(input.roleIds));
  const roles = dedupedRoleIds.length
    ? await prisma.role.findMany({
        where: {
          id: {
            in: dedupedRoleIds,
          },
          servicePartnerId: input.servicePartnerId,
          deletedAt: null,
          ...(session.user.isSuperAdmin ? {} : { scope: "TENANT" }),
        },
        select: {
          id: true,
          key: true,
          scope: true,
        },
      })
    : [];

  if (roles.length !== dedupedRoleIds.length) {
    throw new Error("One or more roles are invalid.");
  }

  if (!session.user.isSuperAdmin) {
    const invalidRole = roles.find((role) => role.scope !== "TENANT" || role.key === "super_admin");
    if (invalidRole) {
      throw new Error("You cannot assign platform or super admin roles.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({
      where: {
        userId: input.userId,
        ...(dedupedRoleIds.length > 0
          ? {
              roleId: {
                notIn: dedupedRoleIds,
              },
            }
          : {}),
      },
    });

    for (const role of roles) {
      await tx.userRole.upsert({
        where: {
          userId_roleId: {
            userId: input.userId,
            roleId: role.id,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          roleId: role.id,
        },
      });
    }
  });

  await invalidateAuthorizationCaches();
  await invalidateTenantDataCaches(input.servicePartnerId);

  return roles;
}

export function getServicePartnerIdForWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createUser(session: Session, input: UserUpsertInput) {
  const servicePartnerId = getServicePartnerIdForWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const user = await prisma.user.create({
    data: {
      servicePartnerId,
      name: input.name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      status: input.status,
    },
  });

  await invalidateTenantDataCaches(servicePartnerId);
  return user;
}

export async function updateUser(session: Session, id: string, input: UserUpsertInput) {
  const existing = await getUserById(session, id);
  if (!existing) {
    throw new Error("User not found.");
  }

  const servicePartnerId = getServicePartnerIdForWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const user = await prisma.user.update({
    where: { id },
    data: {
      servicePartnerId,
      name: input.name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      status: input.status,
    },
  });

  await invalidateTenantDataCaches(servicePartnerId);
  return user;
}

export async function countActiveSuperAdmins() {
  return prisma.user.count({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      roles: {
        some: {
          role: {
            key: "super_admin",
            deletedAt: null,
          },
        },
      },
    },
  });
}

export async function countUserSuperAdminRoles(userId: string) {
  return prisma.userRole.count({
    where: {
      userId,
      role: {
        key: "super_admin",
        deletedAt: null,
      },
    },
  });
}

export async function countActiveCompanyAdminsWithPermissions(input: {
  servicePartnerId: string;
  excludeUserId?: string;
  permissionKeys: string[];
}) {
  const requiredPermissionKeys = Array.from(new Set(input.permissionKeys));

  return prisma.user.count({
    where: {
      servicePartnerId: input.servicePartnerId,
      deletedAt: null,
      status: "ACTIVE",
      ...(input.excludeUserId ? { id: { not: input.excludeUserId } } : {}),
      roles: {
        some: {
          role: {
            key: "company_admin",
            deletedAt: null,
          },
        },
      },
      AND: requiredPermissionKeys.map((permissionKey) => ({
        roles: {
          some: {
            role: {
              permissions: {
                some: {
                  permission: {
                    key: permissionKey,
                  },
                },
              },
            },
          },
        },
      })),
    },
  });
}
