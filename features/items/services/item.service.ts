import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { ItemUpsertInput } from "@/features/items/validations";
import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

export type ItemStockStatus = "active" | "low_stock" | "out_of_stock" | "inactive";

type ListItemsInput = {
  q?: string;
  categoryId?: string;
  subcategoryId?: string;
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
  subcategoryId: string | null;
  uomId: string | null;
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
  subcategory: {
    id: string;
    code: string;
    name: string;
  } | null;
  uom: {
    id: string;
    code: string;
    name: string;
    symbol: string;
  } | null;
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

  if (input.subcategoryId?.trim()) {
    where.subcategoryId = input.subcategoryId.trim();
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
      { subcategory: { name: { contains: q, mode: "insensitive" } } },
      { uom: { name: { contains: q, mode: "insensitive" } } },
      { uom: { symbol: { contains: q, mode: "insensitive" } } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function getItemListInclude() {
  return {
    category: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    subcategory: {
      select: {
        id: true,
        code: true,
        name: true,
      },
    },
    uom: {
      select: {
        id: true,
        code: true,
        name: true,
        symbol: true,
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
      orderBy: [{ updatedAt: "desc" as const }],
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
  } satisfies Prisma.ItemInclude;
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
    include: getItemListInclude(),
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
  const where = buildItemWhere(session, input);

  if (!input.status && typeof input.active !== "boolean") {
    const [items, total] = await Promise.all([
      prisma.item.findMany({
        where,
        skip: pagination.skip,
        take: pagination.take,
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        include: getItemListInclude(),
      }),
      prisma.item.count({ where }),
    ]);

    return {
      items: items.map((item) => toItemListRow(item as ItemMetricRecord)),
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: getTotalPages(total, pagination.pageSize),
    };
  }

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
  const where = buildItemWhere(session, input);
  const distributionPalette = ["#355dff", "#5bc878", "#ff9a1a", "#69a3ff", "#875bff", "#ff8f66"] as const;

  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - 30);

  const [items, missingPrices, pendingUpdates, latestItem] = await Promise.all([
    prisma.item.findMany({
      where,
      select: {
        id: true,
        categoryId: true,
        active: true,
        updatedAt: true,
        category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
    prisma.item.count({
      where: {
        ...where,
        rateCardLines: {
          none: {},
        },
      },
    }),
    prisma.item.count({
      where: {
        ...where,
        updatedAt: {
          lt: staleThreshold,
        },
      },
    }),
    prisma.item.findFirst({
      where,
      orderBy: [{ updatedAt: "desc" }],
      select: {
        updatedAt: true,
      },
    }),
  ]);

  const totalItems = items.length;
  const inactiveItems = items.filter((item) => !item.active).length;
  const categories = new Map<string, { name: string; count: number }>();
  const latestUpdatedAt = latestItem?.updatedAt ?? null;

  const inventoryRows = items.length
    ? await prisma.inventoryItem.groupBy({
        by: ["itemId"],
        where: {
          deletedAt: null,
          itemId: {
            in: items.map((item) => item.id),
          },
        },
        _sum: {
          currentQty: true,
          minQty: true,
        },
      })
    : [];

  const inventoryByItemId = new Map(
    inventoryRows.map((row) => [
      row.itemId,
      {
        totalQty: toNumber(row._sum.currentQty),
        totalMinQty: toNumber(row._sum.minQty),
      },
    ])
  );

  let activeItems = 0;
  let lowStockItems = 0;
  let outOfStockItems = 0;

  for (const item of items) {
    const inventory = inventoryByItemId.get(item.id);
    const totalQty = inventory?.totalQty ?? 0;
    const totalMinQty = inventory?.totalMinQty ?? 0;
    const hasInventory = Boolean(inventory);

    if (!item.active) {
      // already counted in inactiveItems
    } else if (hasInventory && totalQty <= 0) {
      outOfStockItems += 1;
    } else if (hasInventory && totalQty > 0 && totalMinQty > 0 && totalQty <= totalMinQty) {
      lowStockItems += 1;
    } else {
      activeItems += 1;
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
      subcategory: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
      uom: {
        select: {
          id: true,
          code: true,
          name: true,
          symbol: true,
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

export async function listSubcategoriesForItemForm(session: Session, servicePartnerId?: string, categoryId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.subcategory.findMany({
    where: {
      deletedAt: null,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      categoryId: true,
      servicePartnerId: true,
      category: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  });
}

export async function listUomsForItemForm(session: Session, servicePartnerId?: string) {
  const resolvedServicePartnerId = session.user.isSuperAdmin ? servicePartnerId : session.user.servicePartnerId;

  return prisma.uom.findMany({
    where: {
      deletedAt: null,
      active: true,
      ...(resolvedServicePartnerId ? { servicePartnerId: resolvedServicePartnerId } : {}),
      ...scopeByTenant(session, {}),
    },
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      symbol: true,
      servicePartnerId: true,
    },
  });
}

export function getServicePartnerIdForItemWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  if (!inputServicePartnerId || inputServicePartnerId === ALL_SERVICE_PARTNERS_OPTION) {
    return undefined;
  }

  return inputServicePartnerId;
}

async function assertItemTaxonomyConsistency(
  servicePartnerId: string,
  input: Pick<ItemUpsertInput, "categoryId" | "subcategoryId" | "uomId">
) {
  const [category, subcategory, uom] = await Promise.all([
    prisma.category.findFirst({
      where: {
        id: input.categoryId,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        servicePartnerId: true,
      },
    }),
    prisma.subcategory.findFirst({
      where: {
        id: input.subcategoryId,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        categoryId: true,
        servicePartnerId: true,
      },
    }),
    prisma.uom.findFirst({
      where: {
        id: input.uomId,
        deletedAt: null,
        active: true,
      },
      select: {
        id: true,
        code: true,
        symbol: true,
        servicePartnerId: true,
      },
    }),
  ]);

  if (!category || !subcategory || !uom) {
    throw new Error("Item taxonomy records not found.");
  }

  if (category.servicePartnerId !== servicePartnerId) {
    throw new Error("Category and service partner mismatch.");
  }

  if (subcategory.servicePartnerId !== servicePartnerId || subcategory.categoryId !== category.id) {
    throw new Error("Subcategory and category mismatch.");
  }

  if (uom.servicePartnerId !== servicePartnerId) {
    throw new Error("UOM and service partner mismatch.");
  }

  return { category, subcategory, uom };
}

async function getAllPartnerItemMappings(input: Pick<ItemUpsertInput, "categoryId" | "subcategoryId" | "uomId">) {
  const [sourceCategory, sourceSubcategory, sourceUom, servicePartners] = await Promise.all([
    prisma.category.findFirst({
      where: {
        id: input.categoryId,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        servicePartnerId: true,
      },
    }),
    prisma.subcategory.findFirst({
      where: {
        id: input.subcategoryId,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        categoryId: true,
        servicePartnerId: true,
      },
    }),
    prisma.uom.findFirst({
      where: {
        id: input.uomId,
        deletedAt: null,
        active: true,
      },
      select: {
        id: true,
        code: true,
        symbol: true,
        servicePartnerId: true,
      },
    }),
    prisma.servicePartner.findMany({
      where: {
        deletedAt: null,
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
      },
    }),
  ]);

  if (!sourceCategory || !sourceSubcategory || !sourceUom) {
    throw new Error("Item taxonomy records not found.");
  }

  if (
    sourceSubcategory.servicePartnerId !== sourceCategory.servicePartnerId ||
    sourceSubcategory.categoryId !== sourceCategory.id ||
    sourceUom.servicePartnerId !== sourceCategory.servicePartnerId
  ) {
    throw new Error("Selected category, subcategory, and UOM must belong to the same service partner.");
  }

  const [categories, subcategories, uoms] = await Promise.all([
    prisma.category.findMany({
      where: {
        deletedAt: null,
        servicePartnerId: {
          in: servicePartners.map((servicePartner) => servicePartner.id),
        },
        code: sourceCategory.code,
      },
      select: {
        id: true,
        servicePartnerId: true,
      },
    }),
    prisma.subcategory.findMany({
      where: {
        deletedAt: null,
        servicePartnerId: {
          in: servicePartners.map((servicePartner) => servicePartner.id),
        },
        code: sourceSubcategory.code,
        category: {
          deletedAt: null,
          code: sourceCategory.code,
        },
      },
      select: {
        id: true,
        servicePartnerId: true,
      },
    }),
    prisma.uom.findMany({
      where: {
        deletedAt: null,
        active: true,
        servicePartnerId: {
          in: servicePartners.map((servicePartner) => servicePartner.id),
        },
        code: sourceUom.code,
      },
      select: {
        id: true,
        servicePartnerId: true,
        symbol: true,
      },
    }),
  ]);

  if (
    categories.length !== servicePartners.length ||
    subcategories.length !== servicePartners.length ||
    uoms.length !== servicePartners.length
  ) {
    throw new Error("All service partners must have matching category, subcategory, and UOM records before creating this item for all.");
  }

  return {
    servicePartners,
    categoryByServicePartnerId: new Map(categories.map((category) => [category.servicePartnerId, category.id])),
    subcategoryByServicePartnerId: new Map(subcategories.map((subcategory) => [subcategory.servicePartnerId, subcategory.id])),
    uomByServicePartnerId: new Map(uoms.map((uom) => [uom.servicePartnerId, uom])),
  };
}

export async function createItemForAllServicePartners(session: Session, input: ItemUpsertInput) {
  if (!session.user.isSuperAdmin) {
    throw new Error("Only super admins can create items for all service partners.");
  }

  const mappings = await getAllPartnerItemMappings(input);

  return prisma.$transaction(
    mappings.servicePartners.map((servicePartner) => {
      const categoryId = mappings.categoryByServicePartnerId.get(servicePartner.id);
      const subcategoryId = mappings.subcategoryByServicePartnerId.get(servicePartner.id);
      const uom = mappings.uomByServicePartnerId.get(servicePartner.id);

      if (!categoryId || !subcategoryId || !uom) {
        throw new Error("All service partners must have matching category, subcategory, and UOM records before creating this item for all.");
      }

      return prisma.item.create({
        data: {
          servicePartnerId: servicePartner.id,
          categoryId,
          subcategoryId,
          uomId: uom.id,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          unit: uom.symbol.trim().toUpperCase(),
          description: normalizeOptionalString(input.description),
          active: input.active,
        },
      });
    })
  );
}

export async function createItem(session: Session, input: ItemUpsertInput) {
  const servicePartnerId = getServicePartnerIdForItemWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  const { uom } = await assertItemTaxonomyConsistency(servicePartnerId, input);

  return prisma.item.create({
    data: {
      servicePartnerId,
      categoryId: input.categoryId,
      subcategoryId: input.subcategoryId,
      uomId: input.uomId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      unit: uom.symbol.trim().toUpperCase(),
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

  const { uom } = await assertItemTaxonomyConsistency(servicePartnerId, input);

  return prisma.item.update({
    where: { id },
    data: {
      servicePartnerId,
      categoryId: input.categoryId,
      subcategoryId: input.subcategoryId,
      uomId: input.uomId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      unit: uom.symbol.trim().toUpperCase(),
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
