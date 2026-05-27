import { Prisma, ServicePartnerStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { ServicePartnerUpsertInput } from "@/features/service-partners/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

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
  return scopeByTenant(session, {});
}

export function canManageServicePartners(session: Session) {
  return session.user.isSuperAdmin;
}

export async function listServicePartners(session: Session, input: ListServicePartnersInput) {
  const pagination = getPagination(input);
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
  return prisma.servicePartner.findMany({
    where: {
      ...getServicePartnerScopeWhere(session),
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
    },
  });
}

export function isPlatformServicePartnerCode(code: string) {
  return code === env().PLATFORM_SERVICE_PARTNER_CODE;
}

export async function createServicePartner(input: ServicePartnerUpsertInput) {
  return prisma.servicePartner.create({
    data: {
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
}

export async function updateServicePartner(id: string, input: ServicePartnerUpsertInput) {
  return prisma.servicePartner.update({
    where: { id },
    data: {
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
}

export async function updateServicePartnerStatus(id: string, status: ServicePartnerStatus) {
  return prisma.servicePartner.update({
    where: { id },
    data: { status },
  });
}

export async function softDeleteServicePartner(id: string) {
  return prisma.servicePartner.update({
    where: { id },
    data: {
      status: ServicePartnerStatus.INACTIVE,
      deletedAt: new Date(),
    },
  });
}
