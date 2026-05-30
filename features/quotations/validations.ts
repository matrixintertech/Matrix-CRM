import { ApprovalStatus } from "@prisma/client";
import { z } from "zod";

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

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

export const quotationLineSchema = z.object({
  itemId: z.string().uuid(),
  description: optionalString(400),
  quantity: z.preprocess((value) => Number(value), z.number().finite().positive()),
  unitRate: z.preprocess((value) => Number(value), z.number().finite().min(0)),
  taxPercent: optionalNumber.refine((value) => value === undefined || (value >= 0 && value <= 100), {
    message: "Tax percent must be between 0 and 100.",
  }),
});

export const quotationUpsertSchema = z
  .object({
    serviceRequestId: z.string().uuid(),
    validUntil: optionalDate,
    notes: optionalString(1200),
    lines: z.array(quotationLineSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const itemIds = value.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "Duplicate item line is not allowed.",
      });
    }
  });

export const quotationStatusSchema = z.object({
  status: z.nativeEnum(ApprovalStatus),
});

export const quotationSubmitSchema = z.object({
  submittedAt: requiredDate.optional(),
});

export type QuotationUpsertInput = z.infer<typeof quotationUpsertSchema>;
export type QuotationLineInput = z.infer<typeof quotationLineSchema>;
export type QuotationStatusInput = z.infer<typeof quotationStatusSchema>;
