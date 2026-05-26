import { PrismaClient, RoleScope, ServicePartnerStatus, UserStatus } from "@prisma/client";

import { env } from "../lib/config/env";

const prisma = new PrismaClient();

const baselinePermissions = [
  "users.read",
  "users.create",
  "users.update",
  "users.delete",
  "service_requests.read",
  "service_requests.create",
  "service_requests.assign",
  "service_requests.approve",
  "inventory.read",
  "inventory.manage",
  "payments.read",
  "payments.create",
  "reports.read",
] as const;

const baselineNavigation = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/",
    sortOrder: 1,
    permissionKey: "reports.read",
  },
] as const;

const baselineSettings = [
  {
    key: "app.timezone",
    value: { timezone: "Asia/Kolkata" },
    isSecret: false,
  },
  {
    key: "otp.expiry_seconds",
    value: { seconds: 300 },
    isSecret: false,
  },
  {
    key: "otp.max_attempts",
    value: { attempts: 5 },
    isSecret: false,
  },
  {
    key: "otp.resend_cooldown_seconds",
    value: { seconds: 30 },
    isSecret: false,
  },
] as const;

async function seedPlatformServicePartner() {
  const variables = env();

  return prisma.servicePartner.upsert({
    where: { code: variables.PLATFORM_SERVICE_PARTNER_CODE },
    update: {
      name: variables.PLATFORM_SERVICE_PARTNER_NAME,
      status: ServicePartnerStatus.ACTIVE,
    },
    create: {
      code: variables.PLATFORM_SERVICE_PARTNER_CODE,
      name: variables.PLATFORM_SERVICE_PARTNER_NAME,
      status: ServicePartnerStatus.ACTIVE,
    },
  });
}

async function seedSuperAdminRole(servicePartnerId: string) {
  return prisma.role.upsert({
    where: {
      servicePartnerId_key: {
        servicePartnerId,
        key: "super_admin",
      },
    },
    update: {
      name: "Super Admin",
      scope: RoleScope.PLATFORM,
      isSystem: true,
    },
    create: {
      servicePartnerId,
      key: "super_admin",
      name: "Super Admin",
      description: "Platform super administrator",
      scope: RoleScope.PLATFORM,
      isSystem: true,
    },
  });
}

async function seedProjectManagerRole(servicePartnerId: string) {
  return prisma.role.upsert({
    where: {
      servicePartnerId_key: {
        servicePartnerId,
        key: "project_manager",
      },
    },
    update: {
      name: "Project Manager",
      scope: RoleScope.TENANT,
      isSystem: true,
    },
    create: {
      servicePartnerId,
      key: "project_manager",
      name: "Project Manager",
      description: "Development test role with limited permissions",
      scope: RoleScope.TENANT,
      isSystem: true,
    },
  });
}

async function seedPermissions() {
  return Promise.all(
    baselinePermissions.map((permissionKey) => {
      const [rawModule, rawAction] = permissionKey.split(".");
      const permissionModule = rawModule ?? "unknown";
      const action = rawAction ?? "unknown";

      return prisma.permission.upsert({
        where: { key: permissionKey },
        update: {
          module: permissionModule,
          action,
        },
        create: {
          key: permissionKey,
          module: permissionModule,
          action,
          description: `Seeded permission ${permissionKey}`,
        },
      });
    })
  );
}

async function mapRolePermissions(roleId: string, permissionIds: string[]) {
  await Promise.all(
    permissionIds.map((permissionId) =>
      prisma.rolePermission.upsert({
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
      })
    )
  );
}

async function seedNavigation(servicePartnerId: string, permissionsByKey: Map<string, string>) {
  for (const item of baselineNavigation) {
    const navigation = await prisma.navigationItem.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId,
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
        servicePartnerId,
        key: item.key,
        label: item.label,
        href: item.href,
        isActive: true,
        sortOrder: item.sortOrder,
      },
    });

    const permissionId = permissionsByKey.get(item.permissionKey);
    if (!permissionId) {
      continue;
    }

    await prisma.navigationItemPermission.upsert({
      where: {
        navigationItemId_permissionId: {
          navigationItemId: navigation.id,
          permissionId,
        },
      },
      update: {},
      create: {
        navigationItemId: navigation.id,
        permissionId,
      },
    });
  }
}

async function seedSettings(servicePartnerId: string) {
  for (const setting of baselineSettings) {
    await prisma.setting.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId,
          key: setting.key,
        },
      },
      update: {
        value: setting.value,
        isSecret: setting.isSecret,
      },
      create: {
        servicePartnerId,
        key: setting.key,
        value: setting.value,
        isSecret: setting.isSecret,
      },
    });
  }
}

async function seedBootstrapAdmin(servicePartnerId: string, superAdminRoleId: string) {
  const variables = env();
  const email = variables.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const phone = variables.BOOTSTRAP_ADMIN_PHONE?.trim();

  if (!email && !phone) {
    return { created: false, reason: "missing_bootstrap_admin_identifiers" as const };
  }

  const payload = {
    servicePartnerId,
    name: "Super Admin",
    status: UserStatus.ACTIVE,
    email: email ?? null,
    phone: phone ?? null,
  };

  const user = email
    ? await prisma.user.upsert({
        where: { email },
        update: payload,
        create: payload,
      })
    : await prisma.user.upsert({
        where: { phone: phone! },
        update: payload,
        create: payload,
      });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: superAdminRoleId,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: superAdminRoleId,
    },
  });

  return { created: true, userId: user.id as string };
}

async function seedDevelopmentTestUser(
  servicePartnerId: string,
  permissionsByKey: Map<string, string>
) {
  const variables = env();

  if (!variables.SEED_DEV_TEST_USERS) {
    return { enabled: false, created: false };
  }

  if (variables.IS_PRODUCTION) {
    return { enabled: true, created: false, reason: "production_disabled" as const };
  }

  const email = variables.DEV_TEST_USER_EMAIL?.toLowerCase().trim() ?? "project.manager@matrixcrm.local";
  const phone = variables.DEV_TEST_USER_PHONE?.trim() ?? "+910000000001";
  const role = await seedProjectManagerRole(servicePartnerId);
  const allowedPermissionKeys = ["reports.read"] as const;

  for (const permissionKey of allowedPermissionKeys) {
    const permissionId = permissionsByKey.get(permissionKey);
    if (!permissionId) {
      continue;
    }

    await prisma.rolePermission.upsert({
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

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      servicePartnerId,
      name: "Project Manager",
      status: UserStatus.ACTIVE,
      phone,
    },
    create: {
      servicePartnerId,
      name: "Project Manager",
      email,
      phone,
      status: UserStatus.ACTIVE,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId: user.id,
      roleId: role.id,
    },
  });

  return { enabled: true, created: true };
}

async function main() {
  const platform = await seedPlatformServicePartner();
  const superAdminRole = await seedSuperAdminRole(platform.id);

  const permissionRows = await seedPermissions();
  const permissionsByKey = new Map(permissionRows.map((row) => [row.key, row.id]));

  await mapRolePermissions(
    superAdminRole.id,
    permissionRows.map((row) => row.id)
  );
  await seedNavigation(platform.id, permissionsByKey);
  await seedSettings(platform.id);
  const bootstrapAdmin = await seedBootstrapAdmin(platform.id, superAdminRole.id);
  const developmentTestUser = await seedDevelopmentTestUser(platform.id, permissionsByKey);

  console.log("Seed completed", {
    platformServicePartnerId: platform.id,
    superAdminRoleId: superAdminRole.id,
    seededPermissions: permissionRows.length,
    bootstrapAdminCreated: bootstrapAdmin.created,
    developmentTestUserSeedEnabled: developmentTestUser.enabled,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
