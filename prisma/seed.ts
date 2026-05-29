import { PrismaClient, ServicePartnerStatus, UserStatus } from "@prisma/client";

import { env } from "../lib/config/env";
import { ensureTenantRbac } from "../lib/rbac/bootstrap";

const prisma = new PrismaClient();

type SeedResult = {
  platformServicePartnerId: string;
  bootstrapAdminCreated: boolean;
  devUsersSeeded: boolean;
};

async function upsertPlatformServicePartner() {
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

async function assignRoleByKey(userId: string, servicePartnerId: string, roleKey: string) {
  const role = await prisma.role.findFirst({
    where: {
      servicePartnerId,
      key: roleKey,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!role) {
    throw new Error(`Missing role "${roleKey}" for service partner ${servicePartnerId}`);
  }

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId,
        roleId: role.id,
      },
    },
    update: {},
    create: {
      userId,
      roleId: role.id,
    },
  });
}

async function seedBootstrapSuperAdmin(platformServicePartnerId: string) {
  const variables = env();
  const email = variables.BOOTSTRAP_ADMIN_EMAIL?.toLowerCase().trim();
  const phone = variables.BOOTSTRAP_ADMIN_PHONE?.trim();

  if (!email && !phone) {
    return false;
  }

  const payload = {
    servicePartnerId: platformServicePartnerId,
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

  await assignRoleByKey(user.id, platformServicePartnerId, "super_admin");
  return true;
}

async function seedDevTestUsers() {
  const variables = env();
  if (!variables.SEED_DEV_TEST_USERS || variables.IS_PRODUCTION) {
    return false;
  }

  const devTenant = await prisma.servicePartner.upsert({
    where: { code: "DEVCOMPANY" },
    update: {
      name: "Development Company",
      status: ServicePartnerStatus.ACTIVE,
    },
    create: {
      code: "DEVCOMPANY",
      name: "Development Company",
      status: ServicePartnerStatus.ACTIVE,
    },
  });

  await ensureTenantRbac(prisma, {
    servicePartnerId: devTenant.id,
    includePlatformRole: false,
  });

  const companyAdminEmail = variables.DEV_TEST_USER_EMAIL?.toLowerCase().trim() ?? "company.admin@matrixcrm.local";
  const companyAdminPhone = variables.DEV_TEST_USER_PHONE?.trim() ?? "+910000000001";

  const companyAdmin = await prisma.user.upsert({
    where: { email: companyAdminEmail },
    update: {
      servicePartnerId: devTenant.id,
      name: "Company Admin",
      phone: companyAdminPhone,
      status: UserStatus.ACTIVE,
    },
    create: {
      servicePartnerId: devTenant.id,
      name: "Company Admin",
      email: companyAdminEmail,
      phone: companyAdminPhone,
      status: UserStatus.ACTIVE,
    },
  });

  await assignRoleByKey(companyAdmin.id, devTenant.id, "company_admin");
  return true;
}

async function main(): Promise<SeedResult> {
  const platform = await upsertPlatformServicePartner();

  await ensureTenantRbac(prisma, {
    servicePartnerId: platform.id,
    includePlatformRole: true,
  });

  const existingTenants = await prisma.servicePartner.findMany({
    where: {
      id: { not: platform.id },
      deletedAt: null,
    },
    select: { id: true },
  });

  for (const tenant of existingTenants) {
    await ensureTenantRbac(prisma, {
      servicePartnerId: tenant.id,
      includePlatformRole: false,
    });
  }

  const bootstrapAdminCreated = await seedBootstrapSuperAdmin(platform.id);
  const devUsersSeeded = await seedDevTestUsers();

  return {
    platformServicePartnerId: platform.id,
    bootstrapAdminCreated,
    devUsersSeeded,
  };
}

main()
  .then((result) => {
    console.log("Seed completed", result);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
