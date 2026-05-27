import { Prisma, UserStatus } from "@prisma/client";
import type { Session } from "next-auth";

import { getPagination, getTotalPages } from "@/lib/http/pagination";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import type { UserUpsertInput } from "@/features/users/validations";

type ListUsersInput = {
  q?: string;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
};

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || null;
}

export function normalizePhone(phone?: string | null) {
  return phone?.trim() || null;
}

export function getUserTenantWhere(session: Session): Prisma.UserWhereInput {
  return scopeByTenant(session, {});
}

export async function listUsers(session: Session, input: ListUsersInput) {
  const pagination = getPagination(input);
  const where: Prisma.UserWhereInput = {
    ...getUserTenantWhere(session),
    deletedAt: null,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: pagination.skip,
      take: pagination.take,
      orderBy: { createdAt: "desc" },
      include: {
        servicePartner: { select: { name: true, code: true } },
        roles: { include: { role: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    users,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getUserById(session: Session, id: string) {
  return prisma.user.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getUserTenantWhere(session),
    },
    include: {
      servicePartner: { select: { id: true, name: true, code: true } },
      roles: { include: { role: true } },
    },
  });
}

export async function listAssignableRoles(session: Session) {
  return prisma.role.findMany({
    where: {
      deletedAt: null,
      ...(session.user.isSuperAdmin ? {} : { servicePartnerId: session.user.servicePartnerId }),
      ...(session.user.isSuperAdmin ? {} : { scope: "TENANT" }),
    },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
    include: { servicePartner: { select: { name: true, code: true } } },
  });
}

export async function listServicePartnersForUserForm(session: Session) {
  if (!session.user.isSuperAdmin) {
    return prisma.servicePartner.findMany({
      where: { id: session.user.servicePartnerId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    });
  }

  return prisma.servicePartner.findMany({
    where: { deletedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
}

export function getServicePartnerIdForWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createUser(session: Session, input: UserUpsertInput) {
  const servicePartnerId = getServicePartnerIdForWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.user.create({
    data: {
      servicePartnerId,
      name: input.name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      status: input.status,
    },
  });
}

export async function updateUser(session: Session, id: string, input: UserUpsertInput) {
  const existing = await getUserById(session, id);
  if (!existing) {
    throw new Error("User not found.");
  }

  const servicePartnerId = getServicePartnerIdForWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.user.update({
    where: { id },
    data: {
      servicePartnerId,
      name: input.name?.trim() || null,
      email: normalizeEmail(input.email),
      phone: normalizePhone(input.phone),
      status: input.status,
    },
  });
}

export async function countActiveSuperAdmins() {
  return prisma.user.count({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      roles: {
        some: {
          role: {
            key: "super_admin",
            deletedAt: null,
          },
        },
      },
    },
  });
}

export async function countUserSuperAdminRoles(userId: string) {
  return prisma.userRole.count({
    where: {
      userId,
      role: {
        key: "super_admin",
        deletedAt: null,
      },
    },
  });
}
