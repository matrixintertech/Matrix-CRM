import { InvoiceStatus, LedgerSourceType, PaymentStatus } from "@prisma/client";
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

export const financeReportFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  invoiceStatus: z.nativeEnum(InvoiceStatus).optional(),
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  sourceType: z.nativeEnum(LedgerSourceType).optional(),
  dateFrom: optionalDate,
  dateTo: optionalDate,
});

export type FinanceReportFilterInput = z.infer<typeof financeReportFilterSchema>;
