import { ServicePartnerStatus, UserStatus } from "@prisma/client";

import { env } from "../lib/config/env";
import { createPrismaClient } from "../lib/db/client";
import { indiaStateReferences } from "../lib/locations/india-reference";
import { ensureBaselinePermissions, ensureTenantRbac } from "../lib/rbac/bootstrap";

const prisma = createPrismaClient();
const parsedHeartbeatMs = Number(process.env.SEED_HEARTBEAT_MS ?? 30_000);
const SEED_HEARTBEAT_MS = Number.isFinite(parsedHeartbeatMs) && parsedHeartbeatMs >= 5_000 ? parsedHeartbeatMs : 30_000;
const seedStart = Date.now();

type SeedResult = {
  platformServicePartnerId: string;
  bootstrapAdminCreated: boolean;
  devUsersSeeded: boolean;
};

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
}

function logSeed(message: string) {
  console.log(`[seed] ${message}`);
}

async function runStep<T>(name: string, fn: () => Promise<T>) {
  const startedAt = Date.now();
  logSeed(`START ${name}`);
  const result = await fn();
  logSeed(`DONE ${name} (${Date.now() - startedAt}ms)`);
  return result;
}

async function seedLocationReferenceData() {
  for (const stateReference of indiaStateReferences) {
    const state = await prisma.state.upsert({
      where: {
        name: stateReference.name,
      },
      update: {
        code: stateReference.code,
        country: "India",
        isActive: true,
      },
      create: {
        name: stateReference.name,
        code: stateReference.code,
        country: "India",
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    await prisma.city.createMany({
      data: stateReference.cities.map((cityName) => ({
        stateId: state.id,
        name: cityName,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    await prisma.city.updateMany({
      where: {
        stateId: state.id,
        name: {
          in: stateReference.cities,
        },
      },
      data: {
        isActive: true,
      },
    });
  }
}

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
  const heartbeat = setInterval(() => {
    logSeed(`IN_PROGRESS total=${formatDuration(Date.now() - seedStart)}`);
  }, SEED_HEARTBEAT_MS);
  heartbeat.unref();

  await runStep("connect prisma client", async () => prisma.$connect());
  await runStep("seed location reference data", seedLocationReferenceData);
  const permissionIdsByKey = await runStep("ensure baseline permissions", async () => ensureBaselinePermissions(prisma));

  const platform = await runStep("upsert platform service partner", upsertPlatformServicePartner);

  await runStep("ensure platform RBAC baseline", async () =>
    ensureTenantRbac(prisma, {
      servicePartnerId: platform.id,
      includePlatformRole: true,
      permissionIdsByKey,
    })
  );

  const existingTenants = await runStep("load active tenants", async () =>
    prisma.servicePartner.findMany({
      where: {
        id: { not: platform.id },
        deletedAt: null,
      },
      select: { id: true },
    })
  );
  logSeed(`INFO active tenant count=${existingTenants.length}`);

  for (const [index, tenant] of existingTenants.entries()) {
    await runStep(`ensure tenant RBAC baseline (${index + 1}/${existingTenants.length})`, async () =>
      ensureTenantRbac(prisma, {
        servicePartnerId: tenant.id,
        includePlatformRole: false,
        permissionIdsByKey,
      })
    );
  }

  const bootstrapAdminCreated = await runStep("seed bootstrap super admin", async () =>
    seedBootstrapSuperAdmin(platform.id)
  );
  const devUsersSeeded = await runStep("seed development test users", seedDevTestUsers);
  clearInterval(heartbeat);

  return {
    platformServicePartnerId: platform.id,
    bootstrapAdminCreated,
    devUsersSeeded,
  };
}

main()
  .then((result) => {
    logSeed(`COMPLETED total=${formatDuration(Date.now() - seedStart)}`);
    console.log("Seed completed", result);
  })
  .catch((error) => {
    logSeed(`FAILED total=${formatDuration(Date.now() - seedStart)}`);
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    logSeed("DISCONNECT prisma client");
    await prisma.$disconnect();
    logSeed("DISCONNECTED prisma client");
  });
