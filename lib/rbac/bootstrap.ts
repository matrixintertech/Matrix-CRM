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
  permissionIdsByKey?: Map<string, string>;
};

const RBAC_BATCH_SIZE = 12;

async function runInBatches<T>(items: readonly T[], worker: (item: T) => Promise<unknown>, batchSize = RBAC_BATCH_SIZE) {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    for (const item of batch) {
      await worker(item);
    }
  }
}

export async function ensureBaselinePermissions(db: DbLike) {
  const existingPermissions = await db.permission.findMany({
    where: {
      key: {
        in: baselinePermissions.map((permission) => permission.key),
      },
    },
    select: {
      id: true,
      key: true,
      module: true,
      action: true,
      description: true,
    },
  });

  const existingByKey = new Map(existingPermissions.map((permission) => [permission.key, permission]));
  const missingPermissions = baselinePermissions.filter((permission) => !existingByKey.has(permission.key));

  if (missingPermissions.length > 0) {
    await db.permission.createMany({
      data: missingPermissions.map((permission) => ({
        key: permission.key,
        module: permission.module,
        action: permission.action,
        description: permission.description,
      })),
      skipDuplicates: true,
    });
  }

  const stalePermissions = baselinePermissions.filter((permission) => {
    const existing = existingByKey.get(permission.key);
    return (
      existing &&
      (existing.module !== permission.module ||
        existing.action !== permission.action ||
        existing.description !== permission.description)
    );
  });

  await runInBatches(stalePermissions, async (permission) =>
    db.permission.update({
      where: { key: permission.key },
      data: {
        module: permission.module,
        action: permission.action,
        description: permission.description,
      },
    })
  );

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
  const permissionIdsByKey = input.permissionIdsByKey ?? (await ensureBaselinePermissions(db));
  const rolesToSeed = getRoleDefinitions(includePlatformRole);
  const roleKeys = rolesToSeed.map((role) => role.key);

  const existingRoles = await db.role.findMany({
    where: {
      servicePartnerId: input.servicePartnerId,
      key: {
        in: roleKeys,
      },
    },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      scope: true,
      level: true,
      isSystem: true,
    },
  });
  const existingRolesByKey = new Map(existingRoles.map((role) => [role.key, role]));

  const missingRoles = rolesToSeed.filter((role) => !existingRolesByKey.has(role.key));
  if (missingRoles.length > 0) {
    await db.role.createMany({
      data: missingRoles.map((role) => ({
        servicePartnerId: input.servicePartnerId,
        key: role.key,
        name: role.name,
        description: role.description,
        scope: role.scope,
        level: role.level,
        isSystem: role.isSystem,
      })),
      skipDuplicates: true,
    });
  }

  const staleRoles = rolesToSeed.filter((role) => {
    const existing = existingRolesByKey.get(role.key);
    return (
      existing &&
      (existing.name !== role.name ||
        existing.description !== role.description ||
        existing.scope !== role.scope ||
        existing.level !== role.level ||
        existing.isSystem !== role.isSystem)
    );
  });

  await runInBatches(staleRoles, async (role) =>
    db.role.update({
      where: {
        servicePartnerId_key: {
          servicePartnerId: input.servicePartnerId,
          key: role.key,
        },
      },
      data: {
        name: role.name,
        description: role.description,
        scope: role.scope as RoleScope,
        level: role.level,
        isSystem: role.isSystem,
      },
    })
  );

  const roles = await db.role.findMany({
    where: {
      servicePartnerId: input.servicePartnerId,
      key: {
        in: roleKeys,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });

  const roleIdByKey = new Map(roles.map((role) => [role.key, role.id]));
  const roleIds = roles.map((role) => role.id);
  const desiredRolePermissionEdges = new Set<string>();
  const desiredPermissionIdsByRoleId = new Map<string, string[]>();

  for (const [roleKey, permissionKeys] of Object.entries(rolePermissionGrants)) {
    const roleId = roleIdByKey.get(roleKey);
    if (!roleId) {
      continue;
    }

    const allowedPermissionIds = permissionKeys
      .map((permissionKey) => permissionIdsByKey.get(permissionKey))
      .filter((permissionId): permissionId is string => Boolean(permissionId));

    desiredPermissionIdsByRoleId.set(roleId, allowedPermissionIds);
    for (const permissionId of allowedPermissionIds) {
      desiredRolePermissionEdges.add(`${roleId}:${permissionId}`);
    }
  }

  const existingRolePermissions = roleIds.length
    ? await db.rolePermission.findMany({
        where: {
          roleId: {
            in: roleIds,
          },
        },
        select: {
          roleId: true,
          permissionId: true,
        },
      })
    : [];

  const existingRolePermissionEdges = new Set(
    existingRolePermissions.map((entry) => `${entry.roleId}:${entry.permissionId}`)
  );
  const missingRolePermissions = Array.from(desiredRolePermissionEdges)
    .filter((edge) => !existingRolePermissionEdges.has(edge))
    .map((edge) => {
      const [roleId, permissionId] = edge.split(":");
      return {
        roleId: roleId!,
        permissionId: permissionId!,
      };
    });

  if (missingRolePermissions.length > 0) {
    await db.rolePermission.createMany({
      data: missingRolePermissions,
      skipDuplicates: true,
    });
  }

  const staleRolePermissionFilters: Prisma.RolePermissionWhereInput[] = roleIds.map((roleId) => {
    const allowedPermissionIds = desiredPermissionIdsByRoleId.get(roleId) ?? [];
    return {
      roleId,
      ...(allowedPermissionIds.length > 0
        ? {
            permissionId: {
              notIn: allowedPermissionIds,
            },
          }
        : {}),
    };
  });

  if (staleRolePermissionFilters.length > 0) {
    await db.rolePermission.deleteMany({
      where: {
        OR: staleRolePermissionFilters,
      },
    });
  }

  const navKeys = baselineNavigation.map((item) => item.key);
  const existingNavigationItems = await db.navigationItem.findMany({
    where: {
      servicePartnerId: input.servicePartnerId,
      key: {
        in: navKeys,
      },
    },
    select: {
      id: true,
      key: true,
      label: true,
      href: true,
      sortOrder: true,
      isActive: true,
    },
  });
  const existingNavigationByKey = new Map(existingNavigationItems.map((item) => [item.key, item]));

  const missingNavigationItems = baselineNavigation.filter((item) => !existingNavigationByKey.has(item.key));
  if (missingNavigationItems.length > 0) {
    await db.navigationItem.createMany({
      data: missingNavigationItems.map((item) => ({
        servicePartnerId: input.servicePartnerId,
        key: item.key,
        label: item.label,
        href: item.href,
        isActive: item.isActive ?? true,
        sortOrder: item.sortOrder,
      })),
      skipDuplicates: true,
    });
  }

  const staleNavigationItems = baselineNavigation.filter((item) => {
    const existing = existingNavigationByKey.get(item.key);
    return (
      existing &&
      (existing.label !== item.label ||
        existing.href !== item.href ||
        existing.sortOrder !== item.sortOrder ||
        existing.isActive !== (item.isActive ?? true))
    );
  });

  await runInBatches(staleNavigationItems, async (item) =>
    db.navigationItem.update({
      where: {
        servicePartnerId_key: {
          servicePartnerId: input.servicePartnerId,
          key: item.key,
        },
      },
      data: {
        label: item.label,
        href: item.href,
        isActive: item.isActive ?? true,
        sortOrder: item.sortOrder,
      },
    })
  );

  const navigationItems = await db.navigationItem.findMany({
    where: {
      servicePartnerId: input.servicePartnerId,
      key: {
        in: navKeys,
      },
    },
    select: {
      id: true,
      key: true,
    },
  });
  const navigationIdByKey = new Map(navigationItems.map((item) => [item.key, item.id]));
  const navigationItemIds = navigationItems.map((item) => item.id);
  const desiredPermissionIdsByNavigationItemId = new Map<string, string[]>();
  const desiredNavigationEdges = baselineNavigation
    .map((item) => {
      const navigationItemId = navigationIdByKey.get(item.key);
      const permissionId = permissionIdsByKey.get(item.permissionKey);
      if (!navigationItemId || !permissionId) {
        return null;
      }
      return {
        navigationItemId,
        permissionId,
      };
    })
    .filter((edge): edge is { navigationItemId: string; permissionId: string } => Boolean(edge));

  for (const edge of desiredNavigationEdges) {
    const permissions = desiredPermissionIdsByNavigationItemId.get(edge.navigationItemId) ?? [];
    permissions.push(edge.permissionId);
    desiredPermissionIdsByNavigationItemId.set(edge.navigationItemId, permissions);
  }

  const existingNavigationPermissions = navigationItemIds.length
    ? await db.navigationItemPermission.findMany({
        where: {
          navigationItemId: {
            in: navigationItemIds,
          },
        },
        select: {
          navigationItemId: true,
          permissionId: true,
        },
      })
    : [];

  const existingNavigationEdges = new Set(
    existingNavigationPermissions.map((edge) => `${edge.navigationItemId}:${edge.permissionId}`)
  );
  const missingNavigationPermissions = desiredNavigationEdges.filter(
    (edge) => !existingNavigationEdges.has(`${edge.navigationItemId}:${edge.permissionId}`)
  );

  if (missingNavigationPermissions.length > 0) {
    await db.navigationItemPermission.createMany({
      data: missingNavigationPermissions,
      skipDuplicates: true,
    });
  }

  const staleNavigationPermissionFilters: Prisma.NavigationItemPermissionWhereInput[] = navigationItemIds.map(
    (navigationItemId) => {
      const allowedPermissionIds = desiredPermissionIdsByNavigationItemId.get(navigationItemId) ?? [];
      return {
        navigationItemId,
        ...(allowedPermissionIds.length > 0
          ? {
              permissionId: {
                notIn: allowedPermissionIds,
              },
            }
          : {}),
      };
    }
  );

  if (staleNavigationPermissionFilters.length > 0) {
    await db.navigationItemPermission.deleteMany({
      where: {
        OR: staleNavigationPermissionFilters,
      },
    });
  }

  const settingKeys = baselineSettings.map((setting) => setting.key);
  const existingSettings = await db.setting.findMany({
    where: {
      servicePartnerId: input.servicePartnerId,
      key: {
        in: settingKeys,
      },
    },
    select: {
      id: true,
      key: true,
      value: true,
      isSecret: true,
    },
  });
  const existingSettingsByKey = new Map(existingSettings.map((setting) => [setting.key, setting]));
  const missingSettings = baselineSettings.filter((setting) => !existingSettingsByKey.has(setting.key));

  if (missingSettings.length > 0) {
    await db.setting.createMany({
      data: missingSettings.map((setting) => ({
        servicePartnerId: input.servicePartnerId,
        key: setting.key,
        value: setting.value as Prisma.InputJsonValue,
        isSecret: setting.isSecret,
      })),
      skipDuplicates: true,
    });
  }

  const staleSettings = baselineSettings.filter((setting) => {
    const existing = existingSettingsByKey.get(setting.key);
    return (
      existing &&
      (existing.isSecret !== setting.isSecret || JSON.stringify(existing.value) !== JSON.stringify(setting.value))
    );
  });

  await runInBatches(staleSettings, async (setting) =>
    db.setting.update({
      where: {
        servicePartnerId_key: {
          servicePartnerId: input.servicePartnerId,
          key: setting.key,
        },
      },
      data: {
        value: setting.value as Prisma.InputJsonValue,
        isSecret: setting.isSecret,
      },
    })
  );
}

export function getTenantBootstrapRoleKeys() {
  return [...tenantBootstrapRoleKeys];
}
