import { Prisma, RateCardStatus, type RateCardStatus as RateCardStatusType } from "@prisma/client";
import type { Session } from "next-auth";

import type { RateCardLineInput, RateCardUpsertInput } from "@/features/rate-cards/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

export type RateCardListStatus = RateCardStatusType | "EXPIRING_SOON";

type ListRateCardsInput = {
  q?: string;
  status?: RateCardListStatus;
  clientId?: string;
  servicePartnerId?: string;
  categoryId?: string;
  effectiveFrom?: Date;
  page?: number;
  pageSize?: number;
};

type RateCardFilterInput = Omit<ListRateCardsInput, "page" | "pageSize" | "status">;

type RateCardMetricRecord = {
  id: string;
  servicePartnerId: string;
  clientId: string | null;
  code: string;
  name: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: RateCardStatus;
  createdAt: Date;
  updatedAt: Date;
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
  client: {
    id: string;
    code: string;
    name: string;
  } | null;
  lines: Array<{
    id: string;
    rate: Prisma.Decimal;
    taxPercent: Prisma.Decimal | null;
    item: {
      id: string;
      code: string;
      name: string;
      unit: string;
      category: {
        id: string;
        code: string;
        name: string;
      };
    };
  }>;
  _count: {
    lines: number;
  };
};

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

export function getRateCardScopeWhere(session: Session): Prisma.RateCardWhereInput {
  return scopeByTenant(session, {});
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildRateCardWhere(session: Session, input: RateCardFilterInput): Prisma.RateCardWhereInput {
  const where: Prisma.RateCardWhereInput = {
    ...getRateCardScopeWhere(session),
    deletedAt: null,
  };

  if (input.clientId?.trim()) {
    where.clientId = input.clientId.trim();
  }

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (input.categoryId?.trim()) {
    where.lines = {
      some: {
        item: {
          categoryId: input.categoryId.trim(),
        },
      },
    };
  }

  if (input.effectiveFrom) {
    where.effectiveFrom = {
      gte: startOfDay(input.effectiveFrom),
    };
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { client: { name: { contains: q, mode: "insensitive" } } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
      { lines: { some: { item: { name: { contains: q, mode: "insensitive" } } } } },
      { lines: { some: { item: { code: { contains: q, mode: "insensitive" } } } } },
    ];
  }

  return where;
}

function isExpiringSoon(record: { effectiveTo: Date | null; status: RateCardStatus }) {
  if (!record.effectiveTo || record.status !== RateCardStatus.ACTIVE) {
    return false;
  }

  const now = new Date();
  const next30 = new Date();
  next30.setDate(next30.getDate() + 30);
  return record.effectiveTo >= now && record.effectiveTo <= next30;
}

function getDisplayStatus(record: RateCardMetricRecord): RateCardListStatus {
  if (isExpiringSoon(record)) {
    return "EXPIRING_SOON";
  }

  return record.status;
}

function toRateCardListRow(record: RateCardMetricRecord) {
  const categories = new Map<string, { id: string; code: string; name: string }>();
  let totalRate = 0;

  for (const line of record.lines) {
    totalRate += toNumber(line.rate);
    categories.set(line.item.category.id, line.item.category);
  }

  return {
    ...record,
    summary: {
      linkedItems: record._count.lines,
      linkedCategories: categories.size,
      primaryItem: record.lines[0]?.item ?? null,
      averageRate: record.lines.length > 0 ? totalRate / record.lines.length : null,
      displayStatus: getDisplayStatus(record),
      isExpiringSoon: isExpiringSoon(record),
      hasClientMapping: Boolean(record.clientId),
    },
  };
}

async function fetchRateCardsWithMetrics(session: Session, input: RateCardFilterInput) {
  const where = buildRateCardWhere(session, input);

  const rateCards = await prisma.rateCard.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
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
      lines: {
        orderBy: [{ createdAt: "asc" }],
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              category: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
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

  return rateCards.map((rateCard) => toRateCardListRow(rateCard as RateCardMetricRecord));
}

function matchesRequestedStatus(
  rateCard: ReturnType<typeof toRateCardListRow>,
  status?: RateCardListStatus
) {
  if (!status) {
    return true;
  }

  if (status === "EXPIRING_SOON") {
    return rateCard.summary.isExpiringSoon;
  }

  return rateCard.status === status;
}

export async function listRateCards(session: Session, input: ListRateCardsInput) {
  const pagination = getPagination(input);
  const rateCards = await fetchRateCardsWithMetrics(session, input);
  const filtered = rateCards.filter((rateCard) => matchesRequestedStatus(rateCard, input.status));
  const paged = filtered.slice(pagination.skip, pagination.skip + pagination.take);

  return {
    rateCards: paged,
    total: filtered.length,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(filtered.length, pagination.pageSize),
  };
}

export async function getRateCardOverview(session: Session, input: RateCardFilterInput) {
  const rateCards = await fetchRateCardsWithMetrics(session, input);
  const totalRateCards = rateCards.length;
  const activeRateCards = rateCards.filter((rateCard) => rateCard.status === RateCardStatus.ACTIVE).length;
  const draftRateCards = rateCards.filter((rateCard) => rateCard.status === RateCardStatus.DRAFT).length;
  const inactiveRateCards = rateCards.filter((rateCard) => rateCard.status === RateCardStatus.INACTIVE).length;
  const expiredRateCards = rateCards.filter((rateCard) => rateCard.status === RateCardStatus.EXPIRED).length;
  const expiringSoon = rateCards.filter((rateCard) => rateCard.summary.isExpiringSoon).length;
  const linkedItems = rateCards.reduce((sum, rateCard) => sum + rateCard.summary.linkedItems, 0);
  const linkedCategoryIds = new Set<string>();
  let missingItemMapping = 0;
  let latestUpdatedAt: Date | null = null;

  for (const rateCard of rateCards) {
    if (rateCard.summary.linkedItems === 0) {
      missingItemMapping += 1;
    }
    for (const line of rateCard.lines) {
      linkedCategoryIds.add(line.item.category.id);
    }
    if (!latestUpdatedAt || rateCard.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = rateCard.updatedAt;
    }
  }

  return {
    totalRateCards,
    activeRateCards,
    linkedCategories: linkedCategoryIds.size,
    linkedItems,
    expiringSoon,
    draftRateCards,
    inactiveRateCards,
    expiredRateCards,
    missingItemMapping,
    latestUpdatedAt,
  };
}

export async function listRecentRateCards(session: Session, input: RateCardFilterInput) {
  const rateCards = await fetchRateCardsWithMetrics(session, input);
  return rateCards.slice(0, 6);
}

export async function getRateCardFilterOptions(session: Session, input: Omit<RateCardFilterInput, "categoryId" | "q"> = {}) {
  const where = buildRateCardWhere(session, input);
  const categories = await prisma.rateCardLine.findMany({
    where: {
      rateCard: where,
    },
    select: {
      item: {
        select: {
          category: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return Array.from(
    categories.reduce<Map<string, { id: string; code: string; name: string }>>((map, row) => {
      map.set(row.item.category.id, row.item.category);
      return map;
    }, new Map())
  )
    .map(([, value]) => value)
    .sort((left, right) => left.name.localeCompare(right.name));
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
              category: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                },
              },
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
