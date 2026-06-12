import { Prisma, type VendorStatus } from "@prisma/client";
import type { Session } from "next-auth";

import type { VendorUpsertInput } from "@/features/vendors/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";
import { getPagination, getTotalPages } from "@/lib/http/pagination";

type ListVendorsInput = {
  q?: string;
  status?: VendorStatus;
  vendorType?: string;
  page?: number;
  pageSize?: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

export function getVendorScopeWhere(session: Session): Prisma.VendorWhereInput {
  return scopeByTenant(session, {});
}

function buildVendorWhere(session: Session, input: Pick<ListVendorsInput, "q" | "status" | "vendorType">): Prisma.VendorWhereInput {
  const where: Prisma.VendorWhereInput = {
    ...getVendorScopeWhere(session),
    deletedAt: null,
  };

  if (input.status) {
    where.status = input.status;
  }

  if (input.vendorType?.trim()) {
    where.vendorType = input.vendorType.trim();
  }

  if (input.q?.trim()) {
    const q = input.q.trim();
    where.OR = [
      { code: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { gstNumber: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { state: { contains: q, mode: "insensitive" } },
      { vendorType: { contains: q, mode: "insensitive" } },
    ];
  }

  return where;
}

export async function listVendors(session: Session, input: ListVendorsInput) {
  const pagination = getPagination(input);
  const where = buildVendorWhere(session, input);

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
        _count: {
          select: {
            rfqVendors: true,
            purchaseOrders: true,
          },
        },
        rfqVendors: {
          where: {
            rfq: {
              deletedAt: null,
            },
          },
          orderBy: [{ createdAt: "desc" }],
          take: 1,
          select: {
            createdAt: true,
            rfq: {
              select: {
                id: true,
                rfqNumber: true,
              },
            },
          },
        },
        purchaseOrders: {
          where: {
            deletedAt: null,
          },
          orderBy: [{ orderDate: "desc" }],
          take: 1,
          select: {
            id: true,
            poNumber: true,
            orderDate: true,
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

export async function listVendorTypeOptions(session: Session) {
  const vendors = await prisma.vendor.findMany({
    where: {
      ...getVendorScopeWhere(session),
      deletedAt: null,
      vendorType: {
        not: null,
      },
    },
    select: {
      vendorType: true,
    },
    orderBy: [{ vendorType: "asc" }],
  });

  return Array.from(new Set(vendors.map((vendor) => vendor.vendorType?.trim()).filter((value): value is string => Boolean(value))));
}

export async function getVendorOverview(
  session: Session,
  input: Pick<ListVendorsInput, "q" | "vendorType"> = {}
) {
  const vendors = await prisma.vendor.findMany({
    where: buildVendorWhere(session, input),
    select: {
      id: true,
      status: true,
      isVerified: true,
      gstNumber: true,
      panNumber: true,
      vendorType: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          rfqVendors: true,
          purchaseOrders: true,
        },
      },
    },
  });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const categoryMap = new Map<string, number>();
  let totalSuppliers = 0;
  let activeSuppliers = 0;
  let pendingVerificationSuppliers = 0;
  let inactiveSuppliers = 0;
  let rejectedSuppliers = 0;
  let preferredSuppliers = 0;
  let newThisMonth = 0;
  let missingGstDetails = 0;
  let pendingVendorDocuments = 0;

  let latestUpdatedAt: Date | null = null;

  for (const vendor of vendors) {
    totalSuppliers += 1;

    if (!latestUpdatedAt || vendor.updatedAt > latestUpdatedAt) {
      latestUpdatedAt = vendor.updatedAt;
    }

    if (vendor.status === "ACTIVE") {
      activeSuppliers += 1;
    }
    if (vendor.status === "PENDING_VERIFICATION") {
      pendingVerificationSuppliers += 1;
    }
    if (vendor.status === "INACTIVE") {
      inactiveSuppliers += 1;
    }
    if (vendor.status === "REJECTED") {
      rejectedSuppliers += 1;
    }
    if (
      vendor.status === "ACTIVE" &&
      vendor.isVerified &&
      (vendor._count.purchaseOrders > 0 || vendor._count.rfqVendors > 1)
    ) {
      preferredSuppliers += 1;
    }
    if (vendor.createdAt.getMonth() === currentMonth && vendor.createdAt.getFullYear() === currentYear) {
      newThisMonth += 1;
    }
    if (!vendor.gstNumber?.trim()) {
      missingGstDetails += 1;
    }
    if (!vendor.isVerified || !vendor.panNumber?.trim()) {
      pendingVendorDocuments += 1;
    }

    const category = vendor.vendorType?.trim() || "General";
    categoryMap.set(category, (categoryMap.get(category) ?? 0) + 1);
  }

  const categoryDistribution = Array.from(categoryMap.entries())
    .map(([name, count], index) => ({
      id: `${name}-${index}`,
      name,
      count,
      color: ["#315cff", "#8d5bff", "#19b56b", "#ff9a1a", "#12a3ff", "#ff6d5a", "#5d76ff", "#8d98b6"][index % 8],
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 8);

  return {
    totalSuppliers,
    activeSuppliers,
    pendingVerificationSuppliers,
    preferredSuppliers,
    inactiveSuppliers,
    rejectedSuppliers,
    newThisMonth,
    missingGstDetails,
    pendingVendorDocuments,
    latestUpdatedAt,
    categoryDistribution,
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

export async function updateVendorStatus(session: Session, id: string, status: VendorStatus, isVerified?: boolean) {
  const existing = await getVendorById(session, id);
  if (!existing) {
    throw new Error("Vendor not found.");
  }

  return prisma.vendor.update({
    where: { id },
    data: {
      status,
      ...(typeof isVerified === "boolean" ? { isVerified } : {}),
    },
  });
}

export async function softDeleteVendor(session: Session, id: string) {
  const existing = await getVendorById(session, id);
  if (!existing) {
    throw new Error("Vendor not found.");
  }

  return prisma.vendor.update({
    where: { id },
    data: {
      status: "INACTIVE",
      deletedAt: new Date(),
    },
  });
}
