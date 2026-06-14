import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { CategoryUpsertInput } from "@/features/categories/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

export type CategoryListStatus = "active" | "inactive";
export type CategorySortKey = "name-asc" | "name-desc" | "created-desc" | "updated-desc";

type ListCategoriesInput = {
  q?: string;
  servicePartnerId?: string;
  status?: CategoryListStatus;
  sort?: CategorySortKey;
  page?: number;
  pageSize?: number;
};

type CategoryFilterInput = Omit<ListCategoriesInput, "page" | "pageSize" | "sort">;

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getCategoryScopeWhere(session: Session): Prisma.CategoryWhereInput {
  return scopeByTenant(session, {});
}

function buildCategoryWhere(session: Session, input: CategoryFilterInput): Prisma.CategoryWhereInput {
  const where: Prisma.CategoryWhereInput = {
    ...getCategoryScopeWhere(session),
    deletedAt: null,
  };

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (input.status === "active") {
    where.items = {
      some: {
        deletedAt: null,
        active: true,
      },
    };
  }

  if (input.status === "inactive") {
    where.items = {
      none: {
        deletedAt: null,
        active: true,
      },
    };
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

function getCategoryOrderBy(sort?: CategorySortKey): Prisma.CategoryOrderByWithRelationInput[] {
  switch (sort) {
    case "name-asc":
      return [{ name: "asc" }];
    case "name-desc":
      return [{ name: "desc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }];
    case "created-desc":
    default:
      return [{ createdAt: "desc" }];
  }
}

function toCategoryListRow<
  T extends {
    items: Array<{ active: boolean }>;
    _count: { items: number };
  },
>(category: T) {
  const activeItems = category.items.filter((item) => item.active).length;

  return {
    ...category,
    stats: {
      totalItems: category._count.items,
      activeItems,
      inactiveItems: Math.max(category._count.items - activeItems, 0),
      status: activeItems > 0 ? ("active" as const) : ("inactive" as const),
    },
  };
}

export async function listCategories(session: Session, input: ListCategoriesInput) {
  const pagination = getPagination(input);
  const where = buildCategoryWhere(session, input);

  const [categories, total] = await Promise.all([
    prisma.category.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: getCategoryOrderBy(input.sort),
      include: {
        servicePartner: { select: { id: true, code: true, name: true } },
        items: {
          where: {
            deletedAt: null,
          },
          select: {
            active: true,
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
    }),
    prisma.category.count({ where }),
  ]);

  return {
    categories: categories.map(toCategoryListRow),
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getCategoryOverview(session: Session, input: Omit<CategoryFilterInput, "q" | "status">) {
  const where = buildCategoryWhere(session, input);
  const categories = await prisma.category.findMany({
    where,
    select: {
      id: true,
      createdAt: true,
      items: {
        where: {
          deletedAt: null,
        },
        select: {
          id: true,
          active: true,
        },
      },
    },
  });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const distributionMap = {
    empty: 0,
    starter: 0,
    growing: 0,
    dense: 0,
  };

  let activeCategories = 0;
  let totalItems = 0;

  for (const category of categories) {
    const itemCount = category.items.length;
    const activeItemCount = category.items.filter((item) => item.active).length;
    totalItems += itemCount;

    if (activeItemCount > 0) {
      activeCategories += 1;
    }

    if (itemCount === 0) {
      distributionMap.empty += 1;
    } else if (itemCount <= 2) {
      distributionMap.starter += 1;
    } else if (itemCount <= 5) {
      distributionMap.growing += 1;
    } else {
      distributionMap.dense += 1;
    }
  }

  return {
    totalCategories: categories.length,
    activeCategories,
    inactiveCategories: Math.max(categories.length - activeCategories, 0),
    totalItems,
    addedThisMonth: categories.filter((category) => category.createdAt >= monthStart).length,
    distribution: [
      { key: "empty", label: "0 items", count: distributionMap.empty, color: "#ff8f1f" },
      { key: "starter", label: "1-2 items", count: distributionMap.starter, color: "#5bc878" },
      { key: "growing", label: "3-5 items", count: distributionMap.growing, color: "#5f8dff" },
      { key: "dense", label: "6+ items", count: distributionMap.dense, color: "#355dff" },
    ],
  };
}

export async function listRecentCategories(session: Session, input: Omit<CategoryFilterInput, "q">) {
  const where = buildCategoryWhere(session, input);
  const categories = await prisma.category.findMany({
    where,
    take: 5,
    orderBy: [{ createdAt: "desc" }],
    include: {
      servicePartner: { select: { id: true, code: true, name: true } },
      items: {
        where: {
          deletedAt: null,
        },
        select: {
          active: true,
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

  return categories.map(toCategoryListRow);
}

export async function getCategoryById(session: Session, id: string) {
  return prisma.category.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getCategoryScopeWhere(session),
    },
    include: {
      servicePartner: { select: { id: true, code: true, name: true } },
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

export async function listCategoryServicePartnersForForm(session: Session) {
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

export function getServicePartnerIdForCategoryWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createCategory(session: Session, input: CategoryUpsertInput) {
  const servicePartnerId = getServicePartnerIdForCategoryWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.category.create({
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: normalizeOptionalString(input.description),
    },
  });
}

export async function createCategoryForAllServicePartners(session: Session, input: CategoryUpsertInput) {
  if (!session.user.isSuperAdmin) {
    throw new Error("Only super admins can create categories for all service partners.");
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

  if (servicePartners.length === 0) {
    throw new Error("No service partners found.");
  }

  return prisma.$transaction(
    servicePartners.map((servicePartner) =>
      prisma.category.create({
        data: {
          servicePartnerId: servicePartner.id,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          description: normalizeOptionalString(input.description),
        },
      })
    )
  );
}

export async function updateCategory(session: Session, id: string, input: CategoryUpsertInput) {
  const existing = await getCategoryById(session, id);
  if (!existing) {
    throw new Error("Category not found.");
  }

  const servicePartnerId = getServicePartnerIdForCategoryWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.category.update({
    where: { id },
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: normalizeOptionalString(input.description),
    },
  });
}

export async function softDeleteCategory(id: string) {
  return prisma.category.update({
    where: { id },
    data: {
      deletedAt: new Date(),
    },
  });
}
