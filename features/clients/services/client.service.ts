import { Prisma, ClientStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ClientUpsertInput } from "@/features/clients/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { measurePerf } from "@/lib/observability/perf";

type ListClientsInput = {
  q?: string;
  status?: ClientStatus;
  servicePartnerId?: string;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() || null;
}

export function getClientScopeWhere(session: Session): Prisma.ClientWhereInput {
  return scopeByTenant(session, {});
}

export async function listClients(session: Session, input: ListClientsInput) {
  return measurePerf("clients.list", async () => {
    const pagination = getPagination(input);
    const cacheKey = [
      session.user.id,
      session.user.servicePartnerId,
      buildRoleSignature(session.user.roleKeys),
      buildFilterSignature({
        q: input.q?.trim() || null,
        status: input.status ?? null,
        servicePartnerId: input.servicePartnerId?.trim() || null,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");
    const where: Prisma.ClientWhereInput = {
      ...getClientScopeWhere(session),
      deletedAt: null,
    };

    if (input.status) {
      where.status = input.status;
    }

    if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
      where.servicePartnerId = input.servicePartnerId.trim();
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

    const loadClients = async () => {
      const [clients, total] = await Promise.all([
        prisma.client.findMany({
          where,
          skip: pagination.skip,
          take: pagination.take,
          orderBy: [{ createdAt: "desc" }],
          include: {
            servicePartner: { select: { id: true, name: true, code: true } },
            _count: {
              select: {
                branches: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        }),
        prisma.client.count({ where }),
      ]);

      return {
        clients,
        total,
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalPages: getTotalPages(total, pagination.pageSize),
      };
    };

    if (pagination.page === 1) {
      return getOrSetServerCache("clients.list", cacheKey, loadClients, {
        ttlSeconds: 20,
        prefixes: [cachePrefixes.clients, `${cachePrefixes.clients}:tenant:${session.user.servicePartnerId}`],
      });
    }

    return loadClients();
  });
}

export async function getClientById(session: Session, id: string) {
  return prisma.client.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getClientScopeWhere(session),
    },
    include: {
      servicePartner: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
      branches: {
        where: {
          deletedAt: null,
        },
        orderBy: [{ createdAt: "desc" }],
        select: {
          id: true,
          code: true,
          name: true,
          city: true,
          state: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          branches: {
            where: {
              deletedAt: null,
            },
          },
        },
      },
    },
  });
}

export async function listClientServicePartnersForForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return prisma.servicePartner.findMany({
      where: {
        id: session.user.servicePartnerId,
      },
      orderBy: [{ name: "asc" }],
      select: { id: true, code: true, legalName: true, name: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: { id: true, code: true, legalName: true, name: true },
  });
}

export async function listClientsForBranchForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return getOrSetServerCache(
    "options.clients_for_branch_form",
    `${session.user.id}:${resolvedServicePartnerId ?? "all"}`,
    () =>
      prisma.client.findMany({
        where: {
          deletedAt: null,
          ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
          ...getClientScopeWhere(session),
        },
        orderBy: [{ name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          servicePartnerId: true,
        },
      }),
    {
      ttlSeconds: 60,
      prefixes: [cachePrefixes.options, `${cachePrefixes.options}:tenant:${session.user.servicePartnerId}`],
    }
  );
}

export function getServicePartnerIdForClientWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createClient(session: Session, input: ClientUpsertInput) {
  const servicePartnerId = getServicePartnerIdForClientWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const client = await prisma.client.create({
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      legalName: normalizeOptionalString(input.legalName),
      email: normalizeEmail(input.email),
      phone: normalizeOptionalString(input.phone),
      address: normalizeOptionalString(input.address),
      city: normalizeOptionalString(input.city),
      state: normalizeOptionalString(input.state),
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
      status: input.status,
    },
  });

  await invalidateTenantDataCaches(servicePartnerId);
  return client;
}

export async function updateClient(session: Session, id: string, input: ClientUpsertInput) {
  const existing = await getClientById(session, id);
  if (!existing) {
    throw new Error("Client not found.");
  }

  const servicePartnerId = getServicePartnerIdForClientWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const client = await prisma.client.update({
    where: { id },
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      legalName: normalizeOptionalString(input.legalName),
      email: normalizeEmail(input.email),
      phone: normalizeOptionalString(input.phone),
      address: normalizeOptionalString(input.address),
      city: normalizeOptionalString(input.city),
      state: normalizeOptionalString(input.state),
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
      status: input.status,
    },
  });

  await invalidateTenantDataCaches(servicePartnerId);
  return client;
}

export async function updateClientStatus(id: string, status: ClientStatus) {
  const client = await prisma.client.update({
    where: { id },
    data: { status },
  });

  await invalidateTenantDataCaches(client.servicePartnerId);
  return client;
}

export async function softDeleteClient(id: string) {
  const client = await prisma.client.update({
    where: { id },
    data: {
      status: ClientStatus.INACTIVE,
      deletedAt: new Date(),
    },
  });

  await invalidateTenantDataCaches(client.servicePartnerId);
  return client;
}
