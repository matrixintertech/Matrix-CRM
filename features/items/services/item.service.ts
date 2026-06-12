import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { ItemUpsertInput } from "@/features/items/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

export type ItemStockStatus = "active" | "low_stock" | "out_of_stock" | "inactive";

type ListItemsInput = {
  q?: string;
  categoryId?: string;
  servicePartnerId?: string;
  status?: ItemStockStatus;
  active?: boolean;
  page?: number;
  pageSize?: number;
};

type ItemFilterInput = Omit<ListItemsInput, "page" | "pageSize" | "status" | "active">;

type ItemMetricRecord = {
  id: string;
  servicePartnerId: string;
  categoryId: string;
  code: string;
  name: string;
  unit: string;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: {
    id: string;
    code: string;
    name: string;
  };
  servicePartner: {
    id: string;
    code: string;
    name: string;
  };
  inventoryItems: Array<{
    currentQty: Prisma.Decimal;
    minQty: Prisma.Decimal | null;
    maxQty: Prisma.Decimal | null;
    updatedAt: Date;
  }>;
  rateCardLines: Array<{
    rate: Prisma.Decimal;
    updatedAt: Date;
  }>;
  _count: {
    rateCardLines: number;
    inventoryItems: number;
  };
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

export function getItemScopeWhere(session: Session): Prisma.ItemWhereInput {
  return scopeByTenant(session, {});
}

function buildItemWhere(session: Session, input: ItemFilterInput): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {
    ...getItemScopeWhere(session),
    deletedAt: null,
  };

  if (input.categoryId?.trim()) {
    where.categoryId = input.categoryId.trim();
  }

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { unit: { contains: q, mode: "insensitive" } },
      { category: { name: { contains: q, mode: "insensitive" } } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function getItemStockStatus(record: ItemMetricRecord): ItemStockStatus {
  if (!record.active) {
    return "inactive";
  }

  const totalQty = record.inventoryItems.reduce((sum, inventoryItem) => sum + toNumber(inventoryItem.currentQty), 0);
  const totalMinQty = record.inventoryItems.reduce((sum, inventoryItem) => sum + toNumber(inventoryItem.minQty), 0);

  if (record.inventoryItems.length > 0 && totalQty <= 0) {
    return "out_of_stock";
  }

  if (record.inventoryItems.length > 0 && totalQty > 0 && totalMinQty > 0 && totalQty <= totalMinQty) {
    return "low_stock";
  }

  return "active";
}

function toItemListRow(record: ItemMetricRecord) {
  const totalStockQty = record.inventoryItems.reduce((sum, inventoryItem) => sum + toNumber(inventoryItem.currentQty), 0);
  const totalMinQty = record.inventoryItems.reduce((sum, inventoryItem) => sum + toNumber(inventoryItem.minQty), 0);
  const totalMaxQty = record.inventoryItems.reduce((sum, inventoryItem) => sum + toNumber(inventoryItem.maxQty), 0);
  const latestRate = record.rateCardLines[0] ? Number(record.rateCardLines[0].rate) : null;
  const status = getItemStockStatus(record);

  return {
    ...record,
    metrics: {
      status,
      totalStockQty,
      totalMinQty,
      totalMaxQty,
      latestRate,
      inventoryLocations: record._count.inventoryItems,
      hasPrice: latestRate !== null,
    },
  };
}

async function fetchItemsWithMetrics(session: Session, input: ItemFilterInput) {
  const where = buildItemWhere(session, input);
  const items = await prisma.item.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      category: {
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
      inventoryItems: {
        where: {
          deletedAt: null,
        },
        select: {
          currentQty: true,
          minQty: true,
          maxQty: true,
          updatedAt: true,
        },
      },
      rateCardLines: {
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          rate: true,
          updatedAt: true,
        },
      },
      _count: {
        select: {
          rateCardLines: true,
          inventoryItems: {
            where: {
              deletedAt: null,
            },
          },
        },
      },
    },
  });

  return items.map((item) => toItemListRow(item as ItemMetricRecord));
}

function matchesRequestedStatus(item: ReturnType<typeof toItemListRow>, status?: ItemStockStatus, active?: boolean) {
  if (typeof active === "boolean" && item.active !== active) {
    return false;
  }

  if (!status) {
    return true;
  }

  return item.metrics.status === status;
}

export async function listItems(session: Session, input: ListItemsInput) {
  const pagination = getPagination(input);
  const items = await fetchItemsWithMetrics(session, input);
  const filtered = items.filter((item) => matchesRequestedStatus(item, input.status, input.active));
  const paged = filtered.slice(pagination.skip, pagination.skip + pagination.take);

  return {
    items: paged,
    total: filtered.length,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(filtered.length, pagination.pageSize),
  };
}

export async function getItemOverview(session: Session, input: ItemFilterInput) {
  const items = await fetchItemsWithMetrics(session, input);
  const totalItems = items.length;
  const activeItems = items.filter((item) => item.metrics.status === "active").length;
  const lowStockItems = items.filter((item) => item.metrics.status === "low_stock").length;
  const outOfStockItems = items.filter((item) => item.metrics.status === "out_of_stock").length;
  const inactiveItems = items.filter((item) => item.metrics.status === "inactive").length;
  const categories = new Map<string, { name: string; count: number }>();
  let missingPrices = 0;
  let pendingUpdates = 0;
  let latestUpdatedAt: Date | null = null;
  const distributionPalette = ["#355dff", "#5bc878", "#ff9a1a", "#69a3ff", "#875bff", "#ff8f66"] as const;

  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 30);

  for (const item of items) {
    if (!item.metrics.hasPrice) {
      missingPrices += 1;
    }
    if (item.updatedAt < staleThreshold) {
      pendingUpdates += 1;
    }
    if (!latestUpdatedAt || item.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = item.updatedAt;
    }

    const existing = categories.get(item.categoryId);
    if (existing) {
      existing.count += 1;
    } else {
      categories.set(item.categoryId, {
        name: item.category.name,
        count: 1,
      });
    }
  }

  const categoryDistribution = Array.from(categories.entries())
    .map(([id, value], index) => ({
      id,
      name: value.name,
      count: value.count,
      color: distributionPalette[index % distributionPalette.length] ?? "#355dff",
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  return {
    totalItems,
    activeItems,
    lowStockItems,
    outOfStockItems,
    inactiveItems,
    categoriesCount: categories.size,
    missingPrices,
    pendingUpdates,
    latestUpdatedAt,
    stockBreakdown: [
      { key: "active", label: "In Stock", count: activeItems, color: "#30b35f" },
      { key: "low_stock", label: "Low Stock", count: lowStockItems, color: "#ff9a1a" },
      { key: "out_of_stock", label: "Out of Stock", count: outOfStockItems, color: "#ff4f5e" },
      { key: "inactive", label: "Inactive", count: inactiveItems, color: "#b8c5df" },
    ],
    categoryDistribution: categoryDistribution.slice(0, 6),
    popularCategories: categoryDistribution.slice(0, 7),
  };
}

export async function getItemById(session: Session, id: string) {
  return prisma.item.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getItemScopeWhere(session),
    },
    include: {
      category: {
        select: {
          id: true,
          code: true,
          name: true,
          servicePartnerId: true,
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
          rateCardLines: true,
        },
      },
    },
  });
}

export async function listItemServicePartnersForForm(session: Session) {
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

export async function listCategoriesForItemForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.category.findMany({
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

export function getServicePartnerIdForItemWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

async function assertItemCategoryTenantConsistency(categoryId: string, servicePartnerId: string) {
  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });

  if (!category) {
    throw new Error("Category not found.");
  }

  if (category.servicePartnerId !== servicePartnerId) {
    throw new Error("Category and service partner mismatch.");
  }
}

export async function createItem(session: Session, input: ItemUpsertInput) {
  const servicePartnerId = getServicePartnerIdForItemWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertItemCategoryTenantConsistency(input.categoryId, servicePartnerId);

  return prisma.item.create({
    data: {
      servicePartnerId,
      categoryId: input.categoryId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      unit: input.unit.trim().toUpperCase(),
      description: normalizeOptionalString(input.description),
      active: input.active,
    },
  });
}

export async function updateItem(session: Session, id: string, input: ItemUpsertInput) {
  const existing = await getItemById(session, id);
  if (!existing) {
    throw new Error("Item not found.");
  }

  const servicePartnerId = getServicePartnerIdForItemWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertItemCategoryTenantConsistency(input.categoryId, servicePartnerId);

  return prisma.item.update({
    where: { id },
    data: {
      servicePartnerId,
      categoryId: input.categoryId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      unit: input.unit.trim().toUpperCase(),
      description: normalizeOptionalString(input.description),
      active: input.active,
    },
  });
}

export async function updateItemActive(id: string, active: boolean) {
  return prisma.item.update({
    where: { id },
    data: {
      active,
    },
  });
}

export async function softDeleteItem(id: string) {
  return prisma.item.update({
    where: { id },
    data: {
      active: false,
      deletedAt: new Date(),
    },
  });
}
