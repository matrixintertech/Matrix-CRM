import { Prisma, type RateCardStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { RateCardLineInput, RateCardUpsertInput } from "@/features/rate-cards/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListRateCardsInput = {
  q?: string;
  status?: RateCardStatus;
  clientId?: string;
  page?: number;
  pageSize?: number;
};

export function getRateCardScopeWhere(session: Session): Prisma.RateCardWhereInput {
  return scopeByTenant(session, {});
}

export async function listRateCards(session: Session, input: ListRateCardsInput) {
  const pagination = getPagination(input);
  const where: Prisma.RateCardWhereInput = {
    ...getRateCardScopeWhere(session),
    deletedAt: null,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.clientId?.trim()) {
    where.clientId = input.clientId;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }

  const [rateCards, total] = await Promise.all([
    prisma.rateCard.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
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
          },
        },
        _count: {
          select: {
            lines: true,
          },
        },
      },
    }),
    prisma.rateCard.count({ where }),
  ]);

  return {
    rateCards,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getRateCardById(session: Session, id: string) {
  return prisma.rateCard.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getRateCardScopeWhere(session),
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
      lines: {
        orderBy: [{ createdAt: "asc" }],
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              servicePartnerId: true,
              active: true,
            },
          },
        },
      },
      _count: {
        select: {
          lines: true,
        },
      },
    },
  });
}

export async function listRateCardServicePartnersForForm(session: Session) {
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

export async function listClientsForRateCardForm(session: Session, servicePartnerId?: string) {
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

export async function listItemsForRateCardForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.item.findMany({
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
      unit: true,
      active: true,
      servicePartnerId: true,
    },
  });
}

export function getServicePartnerIdForRateCardWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

async function assertClientTenantConsistency(clientId: string | undefined, servicePartnerId: string) {
  if (!clientId) {
    return;
  }

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

async function assertRateCardLineItemsTenantConsistency(lines: RateCardLineInput[], servicePartnerId: string) {
  const itemIds = Array.from(new Set(lines.map((line) => line.itemId)));

  if (itemIds.length !== lines.length) {
    throw new Error("Duplicate item line is not allowed.");
  }

  if (itemIds.length === 0) {
    return;
  }

  const items = await prisma.item.findMany({
    where: {
      id: {
        in: itemIds,
      },
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });

  if (items.length !== itemIds.length) {
    throw new Error("One or more items were not found.");
  }

  if (items.some((item) => item.servicePartnerId !== servicePartnerId)) {
    throw new Error("Item and service partner mismatch.");
  }
}

function toRateCardLineCreateManyInput(rateCardId: string, lines: RateCardLineInput[]) {
  return lines.map((line) => ({
    rateCardId,
    itemId: line.itemId,
    rate: line.rate,
    taxPercent: line.taxPercent ?? null,
  }));
}

export async function createRateCard(session: Session, input: RateCardUpsertInput) {
  const servicePartnerId = getServicePartnerIdForRateCardWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertClientTenantConsistency(input.clientId, servicePartnerId);
  await assertRateCardLineItemsTenantConsistency(input.lines, servicePartnerId);

  return prisma.$transaction(async (tx) => {
    const rateCard = await tx.rateCard.create({
      data: {
        servicePartnerId,
        clientId: input.clientId ?? null,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        status: input.status,
      },
    });

    if (input.lines.length > 0) {
      await tx.rateCardLine.createMany({
        data: toRateCardLineCreateManyInput(rateCard.id, input.lines),
      });
    }

    return rateCard;
  });
}

export async function updateRateCard(session: Session, id: string, input: RateCardUpsertInput) {
  const existing = await getRateCardById(session, id);
  if (!existing) {
    throw new Error("Rate card not found.");
  }

  const servicePartnerId = getServicePartnerIdForRateCardWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertClientTenantConsistency(input.clientId, servicePartnerId);
  await assertRateCardLineItemsTenantConsistency(input.lines, servicePartnerId);

  return prisma.$transaction(async (tx) => {
    const rateCard = await tx.rateCard.update({
      where: { id },
      data: {
        servicePartnerId,
        clientId: input.clientId ?? null,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        status: input.status,
      },
    });

    await tx.rateCardLine.deleteMany({
      where: {
        rateCardId: id,
      },
    });

    if (input.lines.length > 0) {
      await tx.rateCardLine.createMany({
        data: toRateCardLineCreateManyInput(rateCard.id, input.lines),
      });
    }

    return rateCard;
  });
}

export async function updateRateCardStatus(id: string, status: RateCardStatus) {
  return prisma.rateCard.update({
    where: { id },
    data: { status },
  });
}

export async function softDeleteRateCard(id: string) {
  return prisma.rateCard.update({
    where: { id },
    data: {
      status: "INACTIVE",
      deletedAt: new Date(),
    },
  });
}

export function summarizeRateCardLines(lines: RateCardLineInput[]) {
  const lineCount = lines.length;
  const totalRate = lines.reduce((sum, line) => sum + line.rate, 0);

  return {
    lineCount,
    totalRate,
  };
}
