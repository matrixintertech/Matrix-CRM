import { Prisma, RoleScope } from "@prisma/client";
import type { Session } from "next-auth";

import type { RoleUpsertInput } from "@/features/rbac/validations";
import { getUserPermissions, invalidateAuthorizationCaches, isPlatformOnlyPermissionKey } from "@/lib/auth/permissions";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListRolesInput = {
  q?: string;
  scope?: RoleScope;
  page?: number;
  pageSize?: number;
};

function getTenantRoleWhere(session: Session): Prisma.RoleWhereInput {
  const where = scopeByTenant(session, {});
  if (session.user.isSuperAdmin) {
    return where;
  }

  return {
    ...where,
    scope: "TENANT",
  };
}

export async function listRoles(session: Session, input: ListRolesInput) {
  const pagination = getPagination(input);
  const where: Prisma.RoleWhereInput = {
    ...getTenantRoleWhere(session),
    deletedAt: null,
  };

  if (input.scope) {
    where.scope = input.scope;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { key: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const [roles, total] = await Promise.all([
    prisma.role.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ level: "desc" }, { isSystem: "desc" }, { createdAt: "desc" }],
      include: {
        servicePartner: { select: { id: true, name: true, code: true } },
        _count: {
          select: {
            users: true,
            permissions: true,
          },
        },
      },
    }),
    prisma.role.count({ where }),
  ]);

  return {
    roles,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getRoleById(session: Session, id: string) {
  return prisma.role.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getTenantRoleWhere(session),
    },
    include: {
      servicePartner: { select: { id: true, name: true, code: true } },
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
      users: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              status: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });
}

export async function listRoleServicePartnersForForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return prisma.servicePartner.findMany({
      where: {
        id: session.user.servicePartnerId,
      },
      orderBy: {
        name: "asc",
      },
      select: { id: true, name: true, code: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: {
      name: "asc",
    },
    select: { id: true, name: true, code: true },
  });
}

export function getServicePartnerIdForRoleWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createRole(session: Session, input: RoleUpsertInput) {
  const servicePartnerId = getServicePartnerIdForRoleWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const roleScope = session.user.isSuperAdmin ? input.scope : RoleScope.TENANT;
  const roleKey = input.key.trim().toLowerCase();

  return prisma.role.create({
    data: {
      servicePartnerId,
      name: input.name.trim(),
      key: roleKey,
      description: input.description ?? null,
      scope: roleScope,
      level: input.level,
      isSystem: false,
    },
  });
}

export async function updateRole(session: Session, id: string, input: RoleUpsertInput) {
  const existing = await getRoleById(session, id);
  if (!existing) {
    throw new Error("Role not found.");
  }

  if (existing.key === "super_admin") {
    throw new Error("Super admin role cannot be edited.");
  }
  if (existing.isSystem && !session.user.isSuperAdmin) {
    throw new Error("System roles cannot be edited.");
  }

  const nextScope = session.user.isSuperAdmin ? input.scope : RoleScope.TENANT;
  const nextKey = existing.isSystem ? existing.key : input.key.trim().toLowerCase();

  return prisma.role.update({
    where: { id },
    data: {
      name: input.name.trim(),
      key: nextKey,
      description: input.description ?? null,
      scope: nextScope,
      level: input.level,
    },
  });
}

export async function softDeleteRole(session: Session, id: string) {
  const existing = await getRoleById(session, id);
  if (!existing) {
    throw new Error("Role not found.");
  }

  if (existing.key === "super_admin" || existing.isSystem) {
    throw new Error("Protected role cannot be deleted.");
  }

  const activeAssignments = existing.users.filter((entry) => entry.user.deletedAt === null).length;
  if (activeAssignments > 0) {
    throw new Error("Cannot delete a role that is assigned to active users.");
  }

  return prisma.role.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
}

export async function assignPermissionToRole(session: Session, roleId: string, permissionId: string) {
  const role = await getRoleById(session, roleId);
  if (!role) {
    throw new Error("Role not found.");
  }

  if (role.key === "super_admin") {
    throw new Error("Super admin role permissions are protected.");
  }
  if (role.isSystem && !session.user.isSuperAdmin) {
    throw new Error("System role permissions are protected.");
  }

  const permission = await prisma.permission.findUnique({
    where: {
      id: permissionId,
    },
  });

  if (!permission) {
    throw new Error("Permission not found.");
  }

  if (!session.user.isSuperAdmin) {
    if (isPlatformOnlyPermissionKey(permission.key)) {
      throw new Error("You cannot grant platform-only permissions.");
    }
    const currentUserPermissions = new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
    if (!currentUserPermissions.has(permission.key)) {
      throw new Error("You cannot grant permissions you do not have.");
    }
  }

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: permission.id,
    },
  });

  invalidateAuthorizationCaches();

  return { role, permission };
}

export async function removePermissionFromRole(session: Session, roleId: string, permissionId: string) {
  const role = await getRoleById(session, roleId);
  if (!role) {
    throw new Error("Role not found.");
  }

  if (role.key === "super_admin") {
    throw new Error("Super admin role permissions are protected.");
  }
  if (role.isSystem && !session.user.isSuperAdmin) {
    throw new Error("System role permissions are protected.");
  }

  const permission = await prisma.permission.findUnique({
    where: {
      id: permissionId,
    },
  });

  if (!permission) {
    throw new Error("Permission not found.");
  }

  await prisma.rolePermission.deleteMany({
    where: {
      roleId: role.id,
      permissionId: permission.id,
    },
  });

  invalidateAuthorizationCaches();

  return { role, permission };
}

export async function replaceRolePermissions(session: Session, roleId: string, permissionIds: string[]) {
  const role = await getRoleById(session, roleId);
  if (!role) {
    throw new Error("Role not found.");
  }

  if (role.key === "super_admin") {
    throw new Error("Super admin role permissions are protected.");
  }
  if (role.isSystem && !session.user.isSuperAdmin) {
    throw new Error("System role permissions are protected.");
  }

  const dedupedPermissionIds = Array.from(new Set(permissionIds));
  const permissions = dedupedPermissionIds.length
    ? await prisma.permission.findMany({
        where: {
          id: {
            in: dedupedPermissionIds,
          },
        },
        select: {
          id: true,
          key: true,
        },
      })
    : [];

  if (permissions.length !== dedupedPermissionIds.length) {
    throw new Error("One or more permissions are invalid.");
  }

  if (!session.user.isSuperAdmin) {
    const currentUserPermissions = new Set(await getUserPermissions(session.user.id, session.user.roleKeys));
    const unauthorizedPermission = permissions.find(
      (permission) => !currentUserPermissions.has(permission.key) || isPlatformOnlyPermissionKey(permission.key)
    );
    if (unauthorizedPermission) {
      throw new Error("You cannot grant permissions you do not have.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({
      where: {
        roleId: role.id,
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
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId,
        },
      });
    }
  });

  invalidateAuthorizationCaches();

  return role;
}
