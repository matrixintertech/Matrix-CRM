import { ApprovalStatus, Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import type { QuotationLineInput, QuotationStatusInput, QuotationUpsertInput } from "@/features/quotations/validations";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

type QuotationTotals = {
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
};

function normalizeOptionalString(value?: string | null) {
  return value?.trim() || null;
}

function toYyyyMmDd(date: Date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function calculateLine(line: QuotationLineInput) {
  const quantity = roundQuantity(line.quantity);
  const unitRate = roundMoney(line.unitRate);
  const taxPercent = line.taxPercent ?? 0;
  const lineSubtotal = roundMoney(quantity * unitRate);
  const taxAmount = roundMoney((lineSubtotal * taxPercent) / 100);
  const lineTotal = roundMoney(lineSubtotal + taxAmount);

  return {
    quantity,
    unitRate,
    taxPercent,
    lineSubtotal,
    taxAmount,
    lineTotal,
  };
}

function calculateTotals(lines: QuotationLineInput[]) {
  const totals = lines.reduce<QuotationTotals>(
    (acc, line) => {
      const calculated = calculateLine(line);
      acc.subtotal = roundMoney(acc.subtotal + calculated.lineSubtotal);
      acc.taxTotal = roundMoney(acc.taxTotal + calculated.taxAmount);
      acc.grandTotal = roundMoney(acc.grandTotal + calculated.lineTotal);
      return acc;
    },
    { subtotal: 0, taxTotal: 0, grandTotal: 0 }
  );

  return totals;
}

async function generateQuotationNumber(servicePartnerId: string) {
  const servicePartner = await prisma.servicePartner.findUnique({
    where: { id: servicePartnerId },
    select: { code: true },
  });

  const partnerCode = (servicePartner?.code ?? "SP").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "SP";
  const datePart = toYyyyMmDd(new Date());

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const candidate = `QTN-${partnerCode}-${datePart}-${randomPart}`;
    const exists = await prisma.quotation.findFirst({
      where: {
        servicePartnerId,
        quotationNumber: candidate,
      },
      select: { id: true },
    });

    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique quotation number.");
}

async function getServiceRequestTenantScoped(session: Session, serviceRequestId: string) {
  return prisma.serviceRequest.findFirst({
    where: {
      id: serviceRequestId,
      deletedAt: null,
      ...scopeByTenant(session, {}),
    },
    select: {
      id: true,
      clientId: true,
      servicePartnerId: true,
    },
  });
}

async function assertQuotationLineItems(servicePartnerId: string, lines: QuotationLineInput[]) {
  const itemIds = Array.from(new Set(lines.map((line) => line.itemId)));

  if (itemIds.length !== lines.length) {
    throw new Error("Duplicate item line is not allowed.");
  }

  if (itemIds.length === 0) {
    return new Map<
      string,
      {
        id: string;
        name: string;
      }
    >();
  }

  const items = await prisma.item.findMany({
    where: {
      id: {
        in: itemIds,
      },
      servicePartnerId,
      active: true,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (items.length !== itemIds.length) {
    throw new Error("One or more quotation line items are invalid for this tenant.");
  }

  return new Map(items.map((item) => [item.id, item]));
}

function toQuotationItemCreateManyInput(
  quotationId: string,
  lines: QuotationLineInput[],
  itemById: Map<string, { id: string; name: string }>
) {
  return lines.map((line) => {
    const calculated = calculateLine(line);
    const itemName = itemById.get(line.itemId)?.name ?? "Item";
    return {
      quotationId,
      itemId: line.itemId,
      description: normalizeOptionalString(line.description) ?? itemName,
      quantity: calculated.quantity,
      unitRate: calculated.unitRate,
      taxPercent: line.taxPercent ?? null,
      amount: calculated.lineTotal,
    };
  });
}

export function getQuotationScopeWhere(session: Session): Prisma.QuotationWhereInput {
  return scopeByTenant(session, {});
}

export async function getQuotationById(session: Session, quotationId: string) {
  return prisma.quotation.findFirst({
    where: {
      id: quotationId,
      deletedAt: null,
      ...getQuotationScopeWhere(session),
    },
    include: {
      serviceRequest: {
        select: {
          id: true,
          servicePartnerId: true,
          serviceNumber: true,
          title: true,
        },
      },
      items: {
        orderBy: [{ itemId: "asc" }],
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              servicePartnerId: true,
              active: true,
            },
          },
        },
      },
      preparedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });
}

export async function listQuotationsForServiceRequest(session: Session, serviceRequestId: string) {
  const serviceRequest = await getServiceRequestTenantScoped(session, serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  const quotations = await prisma.quotation.findMany({
    where: {
      serviceRequestId: serviceRequest.id,
      servicePartnerId: serviceRequest.servicePartnerId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
    include: {
      items: {
        orderBy: [{ itemId: "asc" }],
        include: {
          item: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
            },
          },
        },
      },
      preparedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      approvedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
    },
  });

  return {
    serviceRequest,
    quotations,
  };
}

export async function listQuotationItemOptions(session: Session, serviceRequestId: string) {
  const serviceRequest = await getServiceRequestTenantScoped(session, serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  const [items, rateCardLines] = await Promise.all([
    prisma.item.findMany({
      where: {
        servicePartnerId: serviceRequest.servicePartnerId,
        active: true,
        deletedAt: null,
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        servicePartnerId: true,
      },
    }),
    prisma.rateCardLine.findMany({
      where: {
        item: {
          servicePartnerId: serviceRequest.servicePartnerId,
          deletedAt: null,
        },
        rateCard: {
          servicePartnerId: serviceRequest.servicePartnerId,
          deletedAt: null,
          status: "ACTIVE",
          OR: [{ clientId: serviceRequest.clientId }, { clientId: null }],
        },
      },
      select: {
        itemId: true,
        rate: true,
        taxPercent: true,
        rateCard: {
          select: {
            clientId: true,
            effectiveFrom: true,
          },
        },
      },
    }),
  ]);

  const sortedRateCardLines = [...rateCardLines].sort((left, right) => {
    const leftClientSpecific = left.rateCard.clientId === serviceRequest.clientId ? 1 : 0;
    const rightClientSpecific = right.rateCard.clientId === serviceRequest.clientId ? 1 : 0;
    if (leftClientSpecific !== rightClientSpecific) {
      return rightClientSpecific - leftClientSpecific;
    }
    return right.rateCard.effectiveFrom.getTime() - left.rateCard.effectiveFrom.getTime();
  });

  const defaultsByItemId = new Map<string, { unitRate: string; taxPercent: string }>();
  for (const line of sortedRateCardLines) {
    if (defaultsByItemId.has(line.itemId)) {
      continue;
    }
    defaultsByItemId.set(line.itemId, {
      unitRate: Number(line.rate).toFixed(2),
      taxPercent: line.taxPercent === null ? "" : Number(line.taxPercent).toFixed(2),
    });
  }

  return items.map((item) => {
    const defaults = defaultsByItemId.get(item.id);
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      servicePartnerId: item.servicePartnerId,
      defaultUnitRate: defaults?.unitRate ?? "0.00",
      defaultTaxPercent: defaults?.taxPercent ?? "",
    };
  });
}

export async function createQuotation(session: Session, input: QuotationUpsertInput) {
  const serviceRequest = await getServiceRequestTenantScoped(session, input.serviceRequestId);
  if (!serviceRequest) {
    throw new Error("Service request not found.");
  }

  const itemById = await assertQuotationLineItems(serviceRequest.servicePartnerId, input.lines);
  const totals = calculateTotals(input.lines);

  const existing = await prisma.quotation.findFirst({
    where: {
      serviceRequestId: serviceRequest.id,
    },
    select: {
      id: true,
      deletedAt: true,
      quotationNumber: true,
    },
  });

  if (existing && !existing.deletedAt) {
    throw new Error("Quotation already exists for this service request.");
  }

  if (existing && existing.deletedAt) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.update({
        where: { id: existing.id },
        data: {
          servicePartnerId: serviceRequest.servicePartnerId,
          serviceRequestId: serviceRequest.id,
          status: ApprovalStatus.PENDING,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          validUntil: input.validUntil ?? null,
          notes: normalizeOptionalString(input.notes),
          preparedByUserId: session.user.id,
          approvedByUserId: null,
          approvedAt: null,
          deletedAt: null,
        },
      });

      await tx.quotationItem.deleteMany({
        where: {
          quotationId: updated.id,
        },
      });

      if (input.lines.length > 0) {
        await tx.quotationItem.createMany({
          data: toQuotationItemCreateManyInput(updated.id, input.lines, itemById),
        });
      }

      return updated;
    });
  }

  const quotationNumber = await generateQuotationNumber(serviceRequest.servicePartnerId);
  return prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.create({
      data: {
        servicePartnerId: serviceRequest.servicePartnerId,
        serviceRequestId: serviceRequest.id,
        quotationNumber,
        status: ApprovalStatus.PENDING,
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        validUntil: input.validUntil ?? null,
        notes: normalizeOptionalString(input.notes),
        preparedByUserId: session.user.id,
      },
    });

    if (input.lines.length > 0) {
      await tx.quotationItem.createMany({
        data: toQuotationItemCreateManyInput(quotation.id, input.lines, itemById),
      });
    }

    return quotation;
  });
}

export async function updateQuotation(session: Session, quotationId: string, input: QuotationUpsertInput) {
  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    throw new Error("Quotation not found.");
  }

  if (existing.serviceRequestId !== input.serviceRequestId) {
    throw new Error("Quotation and service request mismatch.");
  }

  const itemById = await assertQuotationLineItems(existing.servicePartnerId, input.lines);
  const totals = calculateTotals(input.lines);

  return prisma.$transaction(async (tx) => {
    const quotation = await tx.quotation.update({
      where: { id: quotationId },
      data: {
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        validUntil: input.validUntil ?? null,
        notes: normalizeOptionalString(input.notes),
      },
    });

    await tx.quotationItem.deleteMany({
      where: {
        quotationId,
      },
    });

    if (input.lines.length > 0) {
      await tx.quotationItem.createMany({
        data: toQuotationItemCreateManyInput(quotation.id, input.lines, itemById),
      });
    }

    return quotation;
  });
}

export async function updateQuotationStatus(session: Session, quotationId: string, input: QuotationStatusInput) {
  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    throw new Error("Quotation not found.");
  }

  return prisma.quotation.update({
    where: { id: quotationId },
    data: {
      status: input.status,
      approvedByUserId: input.status === ApprovalStatus.APPROVED ? session.user.id : null,
      approvedAt: input.status === ApprovalStatus.APPROVED ? new Date() : null,
    },
  });
}

export async function submitQuotation(session: Session, quotationId: string) {
  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    throw new Error("Quotation not found.");
  }

  return prisma.quotation.update({
    where: { id: quotationId },
    data: {
      status: ApprovalStatus.PENDING,
      approvedByUserId: null,
      approvedAt: null,
    },
  });
}

export async function softDeleteQuotation(session: Session, quotationId: string) {
  const existing = await getQuotationById(session, quotationId);
  if (!existing) {
    throw new Error("Quotation not found.");
  }

  return prisma.quotation.update({
    where: { id: quotationId },
    data: {
      deletedAt: new Date(),
    },
  });
}
