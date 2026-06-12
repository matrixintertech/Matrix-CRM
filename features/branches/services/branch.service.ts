import { ClientStatus, Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { BranchUpsertInput } from "@/features/branches/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListBranchesInput = {
  q?: string;
  clientId?: string;
  servicePartnerId?: string;
  status?: ClientStatus;
  state?: string;
  city?: string;
  page?: number;
  pageSize?: number;
};

type BranchFilterInput = Omit<ListBranchesInput, "page" | "pageSize">;

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getBranchScopeWhere(session: Session): Prisma.BranchWhereInput {
  return scopeByTenant(session, {});
}

function buildBranchWhere(session: Session, input: BranchFilterInput): Prisma.BranchWhereInput {
  const where: Prisma.BranchWhereInput = {
    ...getBranchScopeWhere(session),
    deletedAt: null,
  };

  if (input.clientId?.trim()) {
    where.clientId = input.clientId.trim();
  }

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (input.status) {
    where.client = {
      status: input.status,
    };
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
      { city: { contains: q, mode: "insensitive" } },
      { state: { contains: q, mode: "insensitive" } },
      { client: { code: { contains: q, mode: "insensitive" } } },
      { client: { name: { contains: q, mode: "insensitive" } } },
      { servicePartner: { code: { contains: q, mode: "insensitive" } } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

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

export async function listBranches(session: Session, input: ListBranchesInput) {
  const pagination = getPagination(input);
  const where = buildBranchWhere(session, input);

  const [branches, total] = await Promise.all([
    prisma.branch.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
      include: {
        client: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            _count: {
              select: {
                clientUsers: {
                  where: {
                    deletedAt: null,
                  },
                },
              },
            },
          },
        },
        servicePartner: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        _count: {
          select: {
            serviceRequests: true,
          },
        },
      },
    }),
    prisma.branch.count({ where }),
  ]);
  const contactMap = await listPrimaryContactsByClientIds(
    Array.from(new Set(branches.map((branch) => branch.clientId)))
  );

  return {
    branches: branches.map((branch) => ({
      ...branch,
      primaryContact: contactMap.get(branch.clientId) ?? null,
    })),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getBranchOverview(session: Session, input: Omit<BranchFilterInput, "q" | "clientId">) {
  const where = buildBranchWhere(session, input);
  const branches = await prisma.branch.findMany({
    where,
    select: {
      id: true,
      clientId: true,
      city: true,
      createdAt: true,
      client: {
        select: {
          status: true,
        },
      },
    },
  });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const totalBranches = branches.length;
  const activeBranches = branches.filter((branch) => branch.client.status === ClientStatus.ACTIVE).length;
  const inactiveBranches = totalBranches - activeBranches;
  const companiesCovered = new Set(branches.map((branch) => branch.clientId)).size;
  const citiesCovered = new Set(branches.map((branch) => branch.city?.trim()).filter(Boolean)).size;
  const addedThisMonth = branches.filter((branch) => branch.createdAt >= monthStart).length;

  return {
    totalBranches,
    activeBranches,
    inactiveBranches,
    companiesCovered,
    citiesCovered,
    addedThisMonth,
  };
}

export async function listBranchFilterOptions(session: Session, input: Omit<BranchFilterInput, "q" | "city" | "state" | "clientId"> = {}) {
  const where = buildBranchWhere(session, input);
  const rows = await prisma.branch.findMany({
    where,
    select: {
      city: true,
      state: true,
    },
    orderBy: [{ state: "asc" }, { city: "asc" }],
  });

  const states = Array.from(new Set(rows.map((row) => row.state?.trim()).filter(Boolean) as string[]));
  const cities = Array.from(new Set(rows.map((row) => row.city?.trim()).filter(Boolean) as string[]));

  return { states, cities };
}

export async function listRecentBranches(session: Session, input: Omit<BranchFilterInput, "q" | "clientId">) {
  const where = buildBranchWhere(session, input);
  return prisma.branch.findMany({
    where,
    take: 5,
    orderBy: [{ createdAt: "desc" }],
    include: {
      client: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
        },
      },
      servicePartner: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });
}

export async function listTopBranchCompanies(session: Session, input: Omit<BranchFilterInput, "q" | "clientId">) {
  const where = buildBranchWhere(session, input);
  const branches = await prisma.branch.findMany({
    where,
    select: {
      clientId: true,
      client: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });

  return Array.from(
    branches.reduce<
      Map<
        string,
        {
          id: string;
          code: string;
          name: string;
          count: number;
        }
      >
    >((map, branch) => {
      const current = map.get(branch.clientId);
      if (current) {
        current.count += 1;
        return map;
      }

      map.set(branch.clientId, {
        id: branch.client.id,
        code: branch.client.code,
        name: branch.client.name,
        count: 1,
      });
      return map;
    }, new Map())
  )
    .map(([, value]) => value)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 5);
}

export async function getBranchById(session: Session, id: string) {
  return prisma.branch.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getBranchScopeWhere(session),
    },
    include: {
      servicePartner: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      client: {
        select: {
          id: true,
          code: true,
          name: true,
          servicePartnerId: true,
        },
      },
    },
  });
}

export async function listBranchServicePartnersForForm(session: Session) {
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

  return prisma.client.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      servicePartnerId: true,
    },
  });
}

export function getServicePartnerIdForBranchWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

async function assertBranchClientTenantConsistency(clientId: string, servicePartnerId: string) {
  const client = await prisma.client.findFirst({
    where: {
      id: clientId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });

  if (!client) {
    throw new Error("Client not found.");
  }

  if (client.servicePartnerId !== servicePartnerId) {
    throw new Error("Client and service partner mismatch.");
  }
}

export async function createBranch(session: Session, input: BranchUpsertInput) {
  const servicePartnerId = getServicePartnerIdForBranchWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertBranchClientTenantConsistency(input.clientId, servicePartnerId);

  return prisma.branch.create({
    data: {
      servicePartnerId,
      clientId: input.clientId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      address: normalizeOptionalString(input.address),
      city: normalizeOptionalString(input.city),
      state: normalizeOptionalString(input.state),
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
    },
  });
}

export async function updateBranch(session: Session, id: string, input: BranchUpsertInput) {
  const existing = await getBranchById(session, id);
  if (!existing) {
    throw new Error("Branch not found.");
  }

  const servicePartnerId = getServicePartnerIdForBranchWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertBranchClientTenantConsistency(input.clientId, servicePartnerId);

  return prisma.branch.update({
    where: { id },
    data: {
      servicePartnerId,
      clientId: input.clientId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      address: normalizeOptionalString(input.address),
      city: normalizeOptionalString(input.city),
      state: normalizeOptionalString(input.state),
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
    },
  });
}

export async function softDeleteBranch(id: string) {
  return prisma.branch.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
}
