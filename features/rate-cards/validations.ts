import { RateCardStatus } from "@prisma/client";
import { z } from "zod";

const optionalUuid = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().uuid().optional()
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

export const rateCardLineSchema = z.object({
  itemId: z.string().uuid(),
  rate: z.preprocess((value) => Number(value), z.number().finite().min(0)),
  taxPercent: optionalNumber.refine((value) => value === undefined || (value >= 0 && value <= 100), {
    message: "Tax percent must be between 0 and 100.",
  }),
});

export const rateCardUpsertSchema = z
  .object({
    servicePartnerId: z.string().uuid(),
    clientId: optionalUuid,
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(180),
    effectiveFrom: requiredDate,
    effectiveTo: optionalDate,
    status: z.nativeEnum(RateCardStatus),
    lines: z.array(rateCardLineSchema).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Effective to date must be after effective from date.",
      });
    }

    const itemIds = value.lines.map((line) => line.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: "Duplicate item line is not allowed.",
      });
    }
  });

export const rateCardStatusSchema = z.object({
  status: z.nativeEnum(RateCardStatus),
});

export type RateCardUpsertInput = z.infer<typeof rateCardUpsertSchema>;
export type RateCardLineInput = z.infer<typeof rateCardLineSchema>;
