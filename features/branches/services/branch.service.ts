import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { BranchUpsertInput } from "@/features/branches/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListBranchesInput = {
  q?: string;
  clientId?: string;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getBranchScopeWhere(session: Session): Prisma.BranchWhereInput {
  return scopeByTenant(session, {});
}

export async function listBranches(session: Session, input: ListBranchesInput) {
  const pagination = getPagination(input);
  const where: Prisma.BranchWhereInput = {
    ...getBranchScopeWhere(session),
    deletedAt: null,
  };

  if (input.clientId?.trim()) {
    where.clientId = input.clientId;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { state: { contains: q, mode: "insensitive" } },
    ];
  }

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
    }),
    prisma.branch.count({ where }),
  ]);

  return {
    branches,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
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
      select: { id: true, code: true, name: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: { id: true, code: true, name: true },
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
