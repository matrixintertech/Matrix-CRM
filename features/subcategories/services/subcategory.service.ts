import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { SubcategoryUpsertInput } from "@/features/subcategories/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

type ListSubcategoriesInput = {
  q?: string;
  servicePartnerId?: string;
  categoryId?: string;
};

export async function listSubcategoryServicePartnersForForm(session: Session) {
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

export async function listCategoriesForSubcategoryForm(session: Session, servicePartnerId?: string) {
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

export async function listSubcategories(session: Session, input: ListSubcategoriesInput = {}) {
  const where: Prisma.SubcategoryWhereInput = {
    deletedAt: null,
    ...scopeByTenant(session, {}),
  };

  if (session.user.isSuperAdmin && input.servicePartnerId?.trim()) {
    where.servicePartnerId = input.servicePartnerId.trim();
  }

  if (input.categoryId?.trim()) {
    where.categoryId = input.categoryId.trim();
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { category: { name: { contains: q, mode: "insensitive" } } },
      { servicePartner: { name: { contains: q, mode: "insensitive" } } },
    ];
  }

  return prisma.subcategory.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
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

export function getServicePartnerIdForSubcategoryWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

async function assertSubcategoryCategoryTenantConsistency(categoryId: string, servicePartnerId: string) {
  const category = await prisma.category.findFirst({
    where: {
      id: categoryId,
      deletedAt: null,
    },
    select: {
      id: true,
      servicePartnerId: true,
      code: true,
    },
  });

  if (!category) {
    throw new Error("Category not found.");
  }

  if (category.servicePartnerId !== servicePartnerId) {
    throw new Error("Category and service partner mismatch.");
  }

  return category;
}

export async function createSubcategory(session: Session, input: SubcategoryUpsertInput) {
  const servicePartnerId = getServicePartnerIdForSubcategoryWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  await assertSubcategoryCategoryTenantConsistency(input.categoryId, servicePartnerId);

  return prisma.subcategory.create({
    data: {
      servicePartnerId,
      categoryId: input.categoryId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: normalizeOptionalString(input.description),
    },
  });
}

export async function createSubcategoryForAllServicePartners(session: Session, input: SubcategoryUpsertInput) {
  if (!session.user.isSuperAdmin) {
    throw new Error("Only super admins can create subcategories for all service partners.");
  }

  const sourceCategory = await prisma.category.findFirst({
    where: {
      id: input.categoryId,
      deletedAt: null,
    },
    select: {
      code: true,
    },
  });

  if (!sourceCategory) {
    throw new Error("Category not found.");
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

  const categoryMatches = await prisma.category.findMany({
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
  });

  if (categoryMatches.length !== servicePartners.length) {
    throw new Error("All service partners must have the selected category before creating this subcategory for all.");
  }

  const categoryByServicePartnerId = new Map(categoryMatches.map((category) => [category.servicePartnerId, category.id]));

  return prisma.$transaction(
    servicePartners.map((servicePartner) =>
      prisma.subcategory.create({
        data: {
          servicePartnerId: servicePartner.id,
          categoryId: categoryByServicePartnerId.get(servicePartner.id) as string,
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          description: normalizeOptionalString(input.description),
        },
      })
    )
  );
}
