import type { Prisma, PrismaClient, RoleScope } from "@prisma/client";

import {
  baselineNavigation,
  baselinePermissions,
  baselineRoleDefinitions,
  baselineSettings,
  rolePermissionGrants,
  tenantBootstrapRoleKeys,
} from "@/lib/rbac/baseline";

type DbLike = PrismaClient | Prisma.TransactionClient;

type EnsureTenantRbacInput = {
  servicePartnerId: string;
  includePlatformRole?: boolean;
};

export async function ensureBaselinePermissions(db: DbLike) {
  for (const permission of baselinePermissions) {
    await db.permission.upsert({
      where: { key: permission.key },
      update: {
        module: permission.module,
        action: permission.action,
        description: permission.description,
      },
      create: {
        key: permission.key,
        module: permission.module,
        action: permission.action,
        description: permission.description,
      },
    });
  }

  const permissions = await db.permission.findMany({
    select: { id: true, key: true },
  });
  return new Map(permissions.map((permission) => [permission.key, permission.id]));
}

function getRoleDefinitions(includePlatformRole: boolean) {
  return baselineRoleDefinitions.filter((role) =>
    includePlatformRole ? true : role.scope === "TENANT"
  );
}

export async function ensureTenantRbac(db: DbLike, input: EnsureTenantRbacInput) {
  const includePlatformRole = Boolean(input.includePlatformRole);
  const permissionIdsByKey = await ensureBaselinePermissions(db);
  const rolesToSeed = getRoleDefinitions(includePlatformRole);

  const roles = [];
  for (const role of rolesToSeed) {
    const roleRow = await db.role.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId: input.servicePartnerId,
          key: role.key,
        },
      },
      update: {
        name: role.name,
        description: role.description,
        scope: role.scope as RoleScope,
        isSystem: role.isSystem,
      },
      create: {
        servicePartnerId: input.servicePartnerId,
        key: role.key,
        name: role.name,
        description: role.description,
        scope: role.scope as RoleScope,
        isSystem: role.isSystem,
      },
    });
    roles.push(roleRow);
  }

  const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));

  for (const [roleKey, permissionKeys] of Object.entries(rolePermissionGrants)) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) {
      continue;
    }

    for (const permissionKey of permissionKeys) {
      const permissionId = permissionIdsByKey.get(permissionKey);
      if (!permissionId) {
        continue;
      }

      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId,
            permissionId,
          },
        },
        update: {},
        create: {
          roleId,
          permissionId,
        },
      });
    }
  }

  for (const item of baselineNavigation) {
    const navigationItem = await db.navigationItem.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId: input.servicePartnerId,
          key: item.key,
        },
      },
      update: {
        label: item.label,
        href: item.href,
        isActive: true,
        sortOrder: item.sortOrder,
      },
      create: {
        servicePartnerId: input.servicePartnerId,
        key: item.key,
        label: item.label,
        href: item.href,
        isActive: true,
        sortOrder: item.sortOrder,
      },
    });

    const permissionId = permissionIdsByKey.get(item.permissionKey);
    if (!permissionId) {
      continue;
    }

    await db.navigationItemPermission.upsert({
      where: {
        navigationItemId_permissionId: {
          navigationItemId: navigationItem.id,
          permissionId,
        },
      },
      update: {},
      create: {
        navigationItemId: navigationItem.id,
        permissionId,
      },
    });
  }

  for (const setting of baselineSettings) {
    await db.setting.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId: input.servicePartnerId,
          key: setting.key,
        },
      },
      update: {
        value: setting.value as Prisma.InputJsonValue,
        isSecret: setting.isSecret,
      },
      create: {
        servicePartnerId: input.servicePartnerId,
        key: setting.key,
        value: setting.value as Prisma.InputJsonValue,
        isSecret: setting.isSecret,
      },
    });
  }
}

export function getTenantBootstrapRoleKeys() {
  return [...tenantBootstrapRoleKeys];
}
