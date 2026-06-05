import { InvoiceStatus } from "@prisma/client";
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

const requiredNumber = z.preprocess((value) => Number(value), z.number().finite());

const requiredDate = z.preprocess((value) => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return new Date(value);
  }
  return value;
}, z.date());

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

export const invoiceLineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: requiredNumber.refine((value) => value > 0, {
    message: "Quantity must be greater than 0.",
  }),
  unitRate: requiredNumber.refine((value) => value >= 0, {
    message: "Unit rate cannot be negative.",
  }),
  taxPercent: optionalNumber.refine((value) => value === undefined || (value >= 0 && value <= 100), {
    message: "Tax percent must be between 0 and 100.",
  }),
});

export const invoiceUpsertSchema = z
  .object({
    servicePartnerId: z.string().uuid(),
    vendorId: z.string().uuid(),
    purchaseOrderId: optionalUuid,
    rfqId: optionalUuid,
    serviceRequestId: optionalUuid,
    vendorInvoiceNumber: z.string().trim().min(1).max(120),
    status: z.nativeEnum(InvoiceStatus),
    invoiceDate: requiredDate,
    receivedDate: requiredDate,
    dueDate: optionalDate,
    notes: optionalString(1200),
    items: z.array(invoiceLineSchema).min(1, "At least one invoice line is required."),
  })
  .superRefine((value, ctx) => {
    const itemIds = value.items.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Duplicate invoice line item is not allowed.",
      });
    }

    if (value.dueDate && value.dueDate < value.invoiceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueDate"],
        message: "Due date must be on or after invoice date.",
      });
    }

    if (value.receivedDate < value.invoiceDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receivedDate"],
        message: "Received date must be on or after invoice date.",
      });
    }
  });

export const invoiceStatusSchema = z.object({
  status: z.nativeEnum(InvoiceStatus),
});

export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
export type InvoiceUpsertInput = z.infer<typeof invoiceUpsertSchema>;
