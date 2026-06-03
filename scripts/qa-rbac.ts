import { RoleScope, type PrismaClient } from "@prisma/client";

type QaRoleInput = {
  servicePartnerId: string;
  key: string;
  name: string;
  description: string;
  permissionKeys: string[];
};

export async function ensureQaRoleWithPermissions(prisma: PrismaClient, input: QaRoleInput) {
  const role = await prisma.role.upsert({
    where: {
      servicePartnerId_key: {
        servicePartnerId: input.servicePartnerId,
        key: input.key,
      },
    },
    update: {
      name: input.name,
      description: input.description,
      scope: RoleScope.TENANT,
      isSystem: false,
      deletedAt: null,
    },
    create: {
      servicePartnerId: input.servicePartnerId,
      key: input.key,
      name: input.name,
      description: input.description,
      scope: RoleScope.TENANT,
      isSystem: false,
    },
    select: {
      id: true,
      key: true,
    },
  });

  const uniquePermissionKeys = Array.from(new Set(input.permissionKeys));
  const permissions = uniquePermissionKeys.length
    ? await prisma.permission.findMany({
        where: {
          key: {
            in: uniquePermissionKeys,
          },
        },
        select: {
          id: true,
          key: true,
        },
      })
    : [];

  if (permissions.length !== uniquePermissionKeys.length) {
    const foundKeys = new Set(permissions.map((permission) => permission.key));
    const missingKeys = uniquePermissionKeys.filter((key) => !foundKeys.has(key));
    throw new Error(`Missing QA permissions: ${missingKeys.join(", ")}`);
  }

  const permissionIds = permissions.map((permission) => permission.id);

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        ...(permissionIds.length > 0
          ? {
              permissionId: {
                notIn: permissionIds,
              },
            }
          : {}),
      },
    });

    for (const permissionId of permissionIds) {
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

  return role;
}

export async function replaceUserRoles(prisma: PrismaClient, input: { userId: string; roleIds: string[] }) {
  const roleIds = Array.from(new Set(input.roleIds));

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({
      where: {
        userId: input.userId,
        ...(roleIds.length > 0
          ? {
              roleId: {
                notIn: roleIds,
              },
            }
          : {}),
      },
    });

    for (const roleId of roleIds) {
      await tx.userRole.upsert({
        where: {
          userId_roleId: {
            userId: input.userId,
            roleId,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          roleId,
        },
      });
    }
  });
}

export async function configureQaUserRoleAccess(
  prisma: PrismaClient,
  input: QaRoleInput & { userId: string }
) {
  const role = await ensureQaRoleWithPermissions(prisma, input);
  await replaceUserRoles(prisma, {
    userId: input.userId,
    roleIds: [role.id],
  });
  return role;
}
