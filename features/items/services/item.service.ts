import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { ItemUpsertInput } from "@/features/items/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListItemsInput = {
  q?: string;
  categoryId?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getItemScopeWhere(session: Session): Prisma.ItemWhereInput {
  return scopeByTenant(session, {});
}

export async function listItems(session: Session, input: ListItemsInput) {
  const pagination = getPagination(input);
  const where: Prisma.ItemWhereInput = {
    ...getItemScopeWhere(session),
    deletedAt: null,
  };

  if (input.categoryId?.trim()) {
    where.categoryId = input.categoryId;
  }

  if (typeof input.active === "boolean") {
    where.active = input.active;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { unit: { contains: q, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
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
      },
    }),
    prisma.item.count({ where }),
  ]);

  return {
    items,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
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
