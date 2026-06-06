import { Prisma, ServicePartnerStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ServicePartnerUpsertInput } from "@/features/service-partners/validations";
import { resolveStateCitySelection } from "@/features/locations/services/location.service";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateAuthorizationCaches, invalidateLocationCaches, invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { measurePerf } from "@/lib/observability/perf";
import { ensureBaselinePermissions, ensureTenantRbac } from "@/lib/rbac/bootstrap";

type ListServicePartnersInput = {
  q?: string;
  status?: ServicePartnerStatus;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

export function getServicePartnerScopeWhere(session: Session): Prisma.ServicePartnerWhereInput {
  if (session.user.isSuperAdmin) {
    return {};
  }

  return {
    id: session.user.servicePartnerId,
  };
}

export function canManageServicePartners(session: Session) {
  return session.user.isSuperAdmin;
}

export async function listServicePartners(session: Session, input: ListServicePartnersInput) {
  return measurePerf("service_partners.list", async () => {
    const pagination = getPagination(input);
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");
    const where: Prisma.ServicePartnerWhereInput = {
      ...getServicePartnerScopeWhere(session),
      deletedAt: null,
    };

    if (input.status) {
      where.status = input.status;
    }

    if (input.q?.trim()) {
      const q = input.q.trim();
      where.OR = [
        { code: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ];
    }

    const loadServicePartners = async () => {
      const [servicePartners, total] = await Promise.all([
        prisma.servicePartner.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy: [{ createdAt: "desc" }],
          include: {
            _count: {
              select: {
                users: true,
                clients: true,
                branches: true,
              },
            },
          },
        }),
        prisma.servicePartner.count({ where }),
      ]);

      return {
        servicePartners,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: getTotalPages(total, pagination.pageSize),
      };
    };

    if (pagination.page === 1) {
      return getOrSetServerCache("service_partners.list", cacheKey, loadServicePartners, {
        ttlSeconds: 20,
        prefixes: [cachePrefixes.servicePartners],
      });
    }

    return loadServicePartners();
  });
}

export async function getServicePartnerById(session: Session, id: string) {
  return prisma.servicePartner.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getServicePartnerScopeWhere(session),
    },
    include: {
      _count: {
        select: {
          users: true,
          clients: true,
          branches: true,
        },
      },
    },
  });
}

export async function listServicePartnersForForm(session: Session) {
  return getOrSetServerCache(
    "options.service_partners_for_form",
    `${session.user.id}:${session.user.isSuperAdmin ? "super_admin" : session.user.servicePartnerId}`,
    () =>
      prisma.servicePartner.findMany({
        where: {
          ...getServicePartnerScopeWhere(session),
          deletedAt: null,
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          code: true,
          legalName: true,
          name: true,
          status: true,
        },
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, cachePrefixes.servicePartners],
    }
  );
}

export function isPlatformServicePartnerCode(code: string) {
  return code === env().PLATFORM_SERVICE_PARTNER_CODE;
}

export async function createServicePartner(input: ServicePartnerUpsertInput) {
  const permissionIdsByKey = await ensureBaselinePermissions(prisma);
  const location = await resolveStateCitySelection(input);

  const servicePartner = await prisma.$transaction(async (tx) => {
    const servicePartner = await tx.servicePartner.create({
      data: {
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        legalName: normalizeOptionalString(input.legalName),
        email: normalizeEmail(input.email),
        phone: normalizeOptionalString(input.phone),
        address: normalizeOptionalString(input.address),
        city: location.city,
        state: location.state,
        country: normalizeOptionalString(input.country),
        postalCode: normalizeOptionalString(input.postalCode),
        status: input.status,
      },
    });

    await ensureTenantRbac(tx, {
      servicePartnerId: servicePartner.id,
      includePlatformRole: false,
      permissionIdsByKey,
    });

    return servicePartner;
  }, {
    maxWait: 10_000,
    timeout: 30_000,
  });

  await invalidateAuthorizationCaches();
  await invalidateLocationCaches();
  return servicePartner;
}

export async function updateServicePartner(id: string, input: ServicePartnerUpsertInput) {
  const existing = await prisma.servicePartner.findUnique({
    where: { id },
    select: {
      state: true,
      city: true,
    },
  });
  const allowLegacyPair = Boolean(
    existing &&
      normalizeOptionalString(existing.state) === normalizeOptionalString(input.state) &&
      normalizeOptionalString(existing.city) === normalizeOptionalString(input.city)
  );
  const location = await resolveStateCitySelection(input, {
    allowLegacyPair,
  });

  const servicePartner = await prisma.servicePartner.update({
    where: { id },
    data: {
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      legalName: normalizeOptionalString(input.legalName),
      email: normalizeEmail(input.email),
      phone: normalizeOptionalString(input.phone),
      address: normalizeOptionalString(input.address),
      city: location.city,
      state: location.state,
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
      status: input.status,
    },
  });

  await invalidateTenantDataCaches(servicePartner.id);
  await invalidateLocationCaches();
  return servicePartner;
}

export async function updateServicePartnerStatus(id: string, status: ServicePartnerStatus) {
  const servicePartner = await prisma.servicePartner.update({
    where: { id },
    data: { status },
  });

  await invalidateTenantDataCaches(servicePartner.id);
  return servicePartner;
}

export async function softDeleteServicePartner(id: string) {
  const servicePartner = await prisma.servicePartner.update({
    where: { id },
    data: {
      status: ServicePartnerStatus.INACTIVE,
      deletedAt: new Date(),
    },
  });

  await invalidateTenantDataCaches(servicePartner.id);
  await invalidateAuthorizationCaches();
  return servicePartner;
}
