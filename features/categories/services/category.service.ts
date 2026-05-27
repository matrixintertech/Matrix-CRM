import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { CategoryUpsertInput } from "@/features/categories/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListCategoriesInput = {
  q?: string;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getCategoryScopeWhere(session: Session): Prisma.CategoryWhereInput {
  return scopeByTenant(session, {});
}

export async function listCategories(session: Session, input: ListCategoriesInput) {
  const pagination = getPagination(input);
  const where: Prisma.CategoryWhereInput = {
    ...getCategoryScopeWhere(session),
    deletedAt: null,
  };

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
    ];
  }

  const [categories, total] = await Promise.all([
    prisma.category.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: [{ createdAt: "desc" }],
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
    }),
    prisma.category.count({ where }),
  ]);

  return {
    categories,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
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

