import { RfqStatus, RfqVendorStatus } from "@prisma/client";
import { z } from "zod";

const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().uuid().optional()
);

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

const optionalNumber = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().finite().optional());

const optionalDate = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return new Date(value);
  }
  return value;
}, z.date().optional());

export const rfqLineSchema = z.object({
  itemId: z.string().uuid(),
  description: optionalString(400),
  quantity: z.preprocess((value) => Number(value), z.number().finite().positive()),
  specs: optionalString(500),
  remarks: optionalString(300),
});

export const rfqVendorSchema = z.object({
  vendorId: z.string().uuid(),
  status: z.nativeEnum(RfqVendorStatus).optional(),
  quotedAmount: optionalNumber.refine((value) => value === undefined || value >= 0, {
    message: "Quoted amount cannot be negative.",
  }),
  notes: optionalString(600),
});

export const rfqUpsertSchema = z
  .object({
    servicePartnerId: z.string().uuid(),
    clientId: optionalUuid,
    serviceRequestId: optionalUuid,
    title: z.string().trim().min(2).max(180),
    description: optionalString(1200),
    status: z.nativeEnum(RfqStatus),
    dueDate: optionalDate,
    lines: z.array(rfqLineSchema).default([]),
    vendors: z.array(rfqVendorSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const itemIds = value.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "Duplicate RFQ line item is not allowed.",
      });
    }

    const vendorIds = value.vendors.map((vendor) => vendor.vendorId);
    if (new Set(vendorIds).size !== vendorIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vendors"],
        message: "Duplicate RFQ vendor is not allowed.",
      });
    }
  });

export const rfqStatusSchema = z.object({
  status: z.nativeEnum(RfqStatus),
});

export const rfqSendSchema = z.object({
  sentAt: optionalDate,
});

export const rfqVendorQuoteUpdateSchema = z.object({
  vendorId: z.string().uuid(),
  status: z.nativeEnum(RfqVendorStatus),
  quotedAmount: optionalNumber.refine((value) => value === undefined || value >= 0, {
    message: "Quoted amount cannot be negative.",
  }),
  notes: optionalString(600),
});

export type RfqUpsertInput = z.infer<typeof rfqUpsertSchema>;
export type RfqLineInput = z.infer<typeof rfqLineSchema>;
export type RfqVendorInput = z.infer<typeof rfqVendorSchema>;
