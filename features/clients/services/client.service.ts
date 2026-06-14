import { Prisma, ClientStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ClientUpsertInput } from "@/features/clients/validations";
import { resolveStateCitySelection } from "@/features/locations/services/location.service";
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
  state?: string;
  city?: string;
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

function buildClientWhere(session: Session, input: Omit<ListClientsInput, "page" | "pageSize">): Prisma.ClientWhereInput {
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

  if (input.state?.trim()) {
    where.state = input.state.trim();
  }

  if (input.city?.trim()) {
    where.city = input.city.trim();
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { legalName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { state: { contains: q, mode: "insensitive" } },
      { clientUsers: { some: { user: { name: { contains: q, mode: "insensitive" } } } } },
      { clientUsers: { some: { user: { email: { contains: q, mode: "insensitive" } } } } },
      { clientUsers: { some: { designation: { contains: q, mode: "insensitive" } } } },
    ];
  }

  return where;
}

type ClientListRow = Awaited<ReturnType<typeof listClients>>["clients"][number];

async function listPrimaryContactsByClientIds(clientIds: string[]) {
  if (clientIds.length === 0) {
    return new Map<
      string,
      {
        id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        designation: string | null;
      } | null
    >();
  }

  const contacts = await prisma.clientUser.findMany({
    where: {
      clientId: {
        in: clientIds,
      },
      deletedAt: null,
    },
    select: {
      clientId: true,
      designation: true,
      createdAt: true,
      reportingToId: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: [{ reportingToId: "asc" }, { createdAt: "asc" }],
  });

  const map = new Map<
    string,
    {
      id: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      designation: string | null;
    } | null
  >();

  for (const clientId of clientIds) {
    map.set(clientId, null);
  }

  for (const contact of contacts) {
    if (!map.get(contact.clientId)) {
      map.set(contact.clientId, {
        id: contact.user.id,
        name: contact.user.name,
        email: contact.user.email,
        phone: contact.user.phone,
        designation: contact.designation,
      });
    }
  }

  return map;
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
        state: input.state?.trim() || null,
        city: input.city?.trim() || null,
        page: pagination.page,
        pageSize: pagination.pageSize,
      }),
    ].join(":");
    const where = buildClientWhere(session, input);

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
      const contactMap = await listPrimaryContactsByClientIds(clients.map((client) => client.id));

      return {
        clients: clients.map((client) => ({
          ...client,
          primaryContact: contactMap.get(client.id) ?? null,
        })),
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

export async function getClientOverview(session: Session, input: Omit<ListClientsInput, "page" | "pageSize" | "q">) {
  const where = buildClientWhere(session, input);

  const [clients, totalClients, activeClients, pendingClients, servicePartners] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        status: true,
        createdAt: true,
        servicePartnerId: true,
        state: true,
      },
    }),
    prisma.client.count({ where }),
    prisma.client.count({ where: { ...where, status: ClientStatus.ACTIVE } }),
    prisma.client.count({ where: { ...where, status: ClientStatus.ON_HOLD } }),
    prisma.client.findMany({
      where,
      distinct: ["servicePartnerId"],
      select: {
        servicePartnerId: true,
      },
    }),
  ]);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const addedThisMonth = clients.filter((client) => client.createdAt >= monthStart).length;
  const stateCounts = Array.from(
    clients.reduce<Map<string, number>>((map, client) => {
      if (!client.state) {
        return map;
      }
      map.set(client.state, (map.get(client.state) ?? 0) + 1);
      return map;
    }, new Map())
  )
    .map(([state, count]) => ({ state, count }))
    .sort((left, right) => right.count - left.count || left.state.localeCompare(right.state))
    .slice(0, 5);

  return {
    totalClients,
    activeClients,
    addedThisMonth,
    linkedServicePartners: servicePartners.length,
    pendingClients,
    inactiveClients: clients.filter((client) => client.status === ClientStatus.INACTIVE).length,
    stateCounts,
  };
}

export async function listClientFilterOptions(session: Session) {
  const baseWhere: Prisma.ClientWhereInput = {
    ...getClientScopeWhere(session),
    deletedAt: null,
  };

  const [states, cities] = await Promise.all([
    prisma.client.findMany({
      where: {
        ...baseWhere,
        state: {
          not: null,
        },
      },
      distinct: ["state"],
      select: {
        state: true,
      },
      orderBy: [{ state: "asc" }],
    }),
    prisma.client.findMany({
      where: {
        ...baseWhere,
        city: {
          not: null,
        },
      },
      distinct: ["city"],
      select: {
        city: true,
      },
      orderBy: [{ city: "asc" }],
    }),
  ]);

  return {
    states: states.map((entry) => entry.state).filter((value): value is string => Boolean(value)),
    cities: cities.map((entry) => entry.city).filter((value): value is string => Boolean(value)),
  };
}

export async function listRecentClients(session: Session, input: Omit<ListClientsInput, "page" | "pageSize" | "q">) {
  const where = buildClientWhere(session, input);
  return prisma.client.findMany({
    where,
    take: 5,
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
  const location = await resolveStateCitySelection(input);

  const client = await prisma.client.create({
    data: {
      servicePartnerId,
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
  const allowLegacyPair = Boolean(
    normalizeOptionalString(existing.state) === normalizeOptionalString(input.state) &&
      normalizeOptionalString(existing.city) === normalizeOptionalString(input.city)
  );
  const location = await resolveStateCitySelection(input, {
    allowLegacyPair,
  });

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
      city: location.city,
      state: location.state,
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
