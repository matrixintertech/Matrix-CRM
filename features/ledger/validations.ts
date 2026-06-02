import { LedgerSourceType } from "@prisma/client";
import { z } from "zod";

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

export const ledgerFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  sourceType: z.nativeEnum(LedgerSourceType).optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
});

export type LedgerFilterInput = z.infer<typeof ledgerFilterSchema>;
