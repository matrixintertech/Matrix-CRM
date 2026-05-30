import { Prisma, type VendorStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { VendorUpsertInput } from "@/features/vendors/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListVendorsInput = {
  q?: string;
  status?: VendorStatus;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getVendorScopeWhere(session: Session): Prisma.VendorWhereInput {
  return scopeByTenant(session, {});
}

export async function listVendors(session: Session, input: ListVendorsInput) {
  const pagination = getPagination(input);
  const where: Prisma.VendorWhereInput = {
    ...getVendorScopeWhere(session),
    deletedAt: null,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { gstNumber: { contains: q, mode: "insensitive" } },
    ];
  }

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
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
      },
    }),
    prisma.vendor.count({ where }),
  ]);

  return {
    vendors,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: getTotalPages(total, pagination.pageSize),
  };
}

export async function getVendorById(session: Session, id: string) {
  return prisma.vendor.findFirst({
    where: {
      id,
      deletedAt: null,
      ...getVendorScopeWhere(session),
    },
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
          rfqVendors: true,
        },
      },
    },
  });
}

export async function listVendorServicePartnersForForm(session: Session) {
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

export function getServicePartnerIdForVendorWrite(session: Session, inputServicePartnerId?: string) {
  if (!session.user.isSuperAdmin) {
    return session.user.servicePartnerId;
  }

  return inputServicePartnerId;
}

export async function createVendor(session: Session, input: VendorUpsertInput) {
  const servicePartnerId = getServicePartnerIdForVendorWrite(session, input.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.vendor.create({
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      email: normalizeOptionalString(input.email)?.toLowerCase() ?? null,
      phone: normalizeOptionalString(input.phone),
      status: input.status,
      isVerified: input.isVerified,
      gstNumber: normalizeOptionalString(input.gstNumber)?.toUpperCase() ?? null,
      panNumber: normalizeOptionalString(input.panNumber)?.toUpperCase() ?? null,
      address: normalizeOptionalString(input.address),
      city: normalizeOptionalString(input.city),
      state: normalizeOptionalString(input.state),
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
      vendorType: normalizeOptionalString(input.vendorType),
    },
  });
}

export async function updateVendor(session: Session, id: string, input: VendorUpsertInput) {
  const existing = await getVendorById(session, id);
  if (!existing) {
    throw new Error("Vendor not found.");
  }

  const servicePartnerId = getServicePartnerIdForVendorWrite(session, input.servicePartnerId ?? existing.servicePartnerId);
  if (!servicePartnerId) {
    throw new Error("Service partner is required.");
  }

  return prisma.vendor.update({
    where: { id },
    data: {
      servicePartnerId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      email: normalizeOptionalString(input.email)?.toLowerCase() ?? null,
      phone: normalizeOptionalString(input.phone),
      status: input.status,
      isVerified: input.isVerified,
      gstNumber: normalizeOptionalString(input.gstNumber)?.toUpperCase() ?? null,
      panNumber: normalizeOptionalString(input.panNumber)?.toUpperCase() ?? null,
      address: normalizeOptionalString(input.address),
      city: normalizeOptionalString(input.city),
      state: normalizeOptionalString(input.state),
      country: normalizeOptionalString(input.country),
      postalCode: normalizeOptionalString(input.postalCode),
      vendorType: normalizeOptionalString(input.vendorType),
    },
  });
}

export async function updateVendorStatus(id: string, status: VendorStatus, isVerified?: boolean) {
  return prisma.vendor.update({
    where: { id },
    data: {
      status,
      ...(typeof isVerified === "boolean" ? { isVerified } : {}),
    },
  });
}

export async function softDeleteVendor(id: string) {
  return prisma.vendor.update({
    where: { id },
    data: {
      status: "INACTIVE",
      deletedAt: new Date(),
    },
  });
}
