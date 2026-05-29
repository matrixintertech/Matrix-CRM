import { Prisma, UserStatus } from "@prisma/client";
import type { Session } from "next-auth";

import { getUserPermissions, isPlatformOnlyPermissionKey } from "@/lib/auth/permissions";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import type { UserUpsertInput } from "@/features/users/validations";

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
      include: {
        servicePartner: { select: { name: true, code: true } },
        roles: { include: { role: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
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
      roles: { include: { role: true } },
      directPermissions: {
        where: { allowed: true },
        select: {
          permission: {
            select: {
              id: true,
              key: true,
              module: true,
              action: true,
              description: true,
            },
          },
          assignedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          permission: {
            key: "asc",
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
      select: { id: true, name: true, code: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
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

export async function listRoleTemplatePermissionIds(roleIds: string[]) {
  if (roleIds.length === 0) {
    return {} as Record<string, string[]>;
  }

  const rows = await prisma.rolePermission.findMany({
    where: {
      roleId: {
        in: roleIds,
      },
    },
    select: {
      roleId: true,
      permissionId: true,
    },
  });

  const map: Record<string, string[]> = {};
  for (const row of rows) {
    const current = map[row.roleId] ?? [];
    current.push(row.permissionId);
    map[row.roleId] = current;
  }

  return map;
}

export async function resolveGrantablePermissionIds(session: Session, requestedPermissionIds: string[]) {
  const dedupedPermissionIds = Array.from(new Set(requestedPermissionIds));
  if (dedupedPermissionIds.length === 0) {
    return [];
  }

  const permissions = await prisma.permission.findMany({
    where: {
      id: {
        in: dedupedPermissionIds,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });

  if (permissions.length !== dedupedPermissionIds.length) {
    throw new Error("One or more permissions are invalid.");
  }

  if (session.user.isSuperAdmin) {
    return dedupedPermissionIds;
  }

  const ownPermissionSet = new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
  const unauthorizedPermission = permissions.find(
    (permission) => !ownPermissionSet.has(permission.key) || isPlatformOnlyPermissionKey(permission.key)
  );

  if (unauthorizedPermission) {
    throw new Error("You cannot grant permissions you do not have.");
  }

  return dedupedPermissionIds;
}

export async function replaceUserDirectPermissions(input: {
  userId: string;
  servicePartnerId: string;
  permissionIds: string[];
  assignedByUserId?: string;
}) {
  const dedupedPermissionIds = Array.from(new Set(input.permissionIds));

  await prisma.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({
      where: {
        userId: input.userId,
        ...(dedupedPermissionIds.length > 0
          ? {
              permissionId: {
                notIn: dedupedPermissionIds,
              },
            }
          : {}),
      },
    });

    for (const permissionId of dedupedPermissionIds) {
      await tx.userPermission.upsert({
        where: {
          userId_permissionId: {
            userId: input.userId,
            permissionId,
          },
        },
        update: {
          allowed: true,
          servicePartnerId: input.servicePartnerId,
          assignedByUserId: input.assignedByUserId ?? null,
        },
        create: {
          userId: input.userId,
          permissionId,
          allowed: true,
          servicePartnerId: input.servicePartnerId,
          assignedByUserId: input.assignedByUserId ?? null,
        },
      });
    }
  });
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
        directPermissions: {
          some: {
            allowed: true,
            permission: {
              key: permissionKey,
            },
          },
        },
      })),
    },
  });
}
