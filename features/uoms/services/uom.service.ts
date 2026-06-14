import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { UomUpsertInput } from "@/features/uoms/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

type ListUomsInput = {
  q?: string;
  servicePartnerId?: string;
  active?: boolean;
};

export async function listUomServicePartnersForForm(session: Session) {
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

export async function listUoms(session: Session, input: ListUomsInput = {}) {
  const where: Prisma.UomWhereInput = {
    deletedAt: null,
    ...scopeByTenant(session, {}),
  };

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (typeof input.active === "boolean") {
    where.active = input.active;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { symbol: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return prisma.uom.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    include: {
      servicePartner: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      _count: {
        select: {
          items: {
            where: {
              deletedAt: null,
            },
          },
        },
      },
    },
  });
}

export function getServicePartnerIdForUomWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createUom(session: Session, input: UomUpsertInput) {
  const servicePartnerId = getServicePartnerIdForUomWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.uom.create({
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      symbol: input.symbol.trim().toUpperCase(),
      description: normalizeOptionalString(input.description),
      active: input.active,
    },
  });
}

export async function createUomForAllServicePartners(session: Session, input: UomUpsertInput) {
  if (!session.user.isSuperAdmin) {
    throw new Error("Only super admins can create UOMs for all service partners.");
  }

  const servicePartners = await prisma.servicePartner.findMany({
    where: {
      deletedAt: null,
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
    },
  });

  return prisma.$transaction(
    servicePartners.map((servicePartner) =>
      prisma.uom.create({
        data: {
          servicePartnerId: servicePartner.id,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          symbol: input.symbol.trim().toUpperCase(),
          description: normalizeOptionalString(input.description),
          active: input.active,
        },
      })
    )
  );
}
