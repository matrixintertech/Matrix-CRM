import { Prisma, UserStatus } from "@prisma/client";
import type { Session } from "next-auth";

import { getUserPermissions, invalidateAuthorizationCaches, isPlatformOnlyPermissionKey } from "@/lib/auth/permissions";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import type { UserUpsertInput } from "@/features/users/validations";
import { measurePerf } from "@/lib/observability/perf";

type ListUsersInput = {
  q?: string;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
};

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

export async function listUsers(session: Session, input: ListUsersInput) {
  return measurePerf("users.list", async () => {
    const pagination = getPagination(input);
    const where: Prisma.UserWhereInput = {
      ...getUserTenantWhere(session),
      deletedAt: null,
    };

    if (input.status) {
      where.status = input.status;
    }

    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

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
          createdAt: true,
          servicePartnerId: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    const servicePartnerIds = Array.from(
      new Set(users.map((user) => user.servicePartnerId).filter((servicePartnerId): servicePartnerId is string => Boolean(servicePartnerId)))
    );
    const userIds = users.map((user) => user.id);

    const [servicePartners, userRoles] = await Promise.all([
      servicePartnerIds.length > 0
        ? prisma.servicePartner.findMany({
            where: {
              id: {
                in: servicePartnerIds,
              },
            },
            select: {
              id: true,
              name: true,
              code: true,
            },
          })
        : Promise.resolve([]),
      userIds.length > 0
        ? prisma.userRole.findMany({
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
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const servicePartnerMap = new Map(servicePartners.map((servicePartner) => [servicePartner.id, servicePartner]));
    const userRolesMap = userRoles.reduce<Map<string, Array<{ role: { key: string; name: string } }>>>((map, entry) => {
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
        createdAt: user.createdAt,
        servicePartner: servicePartnerMap.get(user.servicePartnerId) ?? { name: "-", code: "-" },
        roles: userRolesMap.get(user.id) ?? [],
      })),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: getTotalPages(total, pagination.pageSize),
    };
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
    return prisma.servicePartner.findMany({
      where: { id: session.user.servicePartnerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, legalName: true, code: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, legalName: true, code: true },
  });
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

  invalidateAuthorizationCaches();

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

  return prisma.user.create({
    data: {
      servicePartnerId,
      name: input.name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      status: input.status,
    },
  });
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

  return prisma.user.update({
    where: { id },
    data: {
      servicePartnerId,
      name: input.name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      status: input.status,
    },
  });
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
