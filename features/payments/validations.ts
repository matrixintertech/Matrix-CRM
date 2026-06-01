import { PaymentStatus } from "@prisma/client";
import { z } from "zod";

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

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

export const paymentModeValues = ["CASH", "BANK_TRANSFER", "UPI", "CHEQUE", "CARD", "OTHER"] as const;
export const paymentModeSchema = z.enum(paymentModeValues);

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: requiredNumber.refine((value) => value > 0, {
    message: "Amount must be greater than 0.",
  }),
  paymentDate: requiredDate,
  mode: paymentModeSchema,
  referenceNumber: optionalString(120),
  notes: optionalString(1200),
  status: z.nativeEnum(PaymentStatus).default(PaymentStatus.PAID),
});

export const updatePaymentSchema = z.object({
  amount: requiredNumber.refine((value) => value > 0, {
    message: "Amount must be greater than 0.",
  }),
  paymentDate: requiredDate,
  mode: paymentModeSchema,
  referenceNumber: optionalString(120),
  notes: optionalString(1200),
  status: z.nativeEnum(PaymentStatus),
});

export const updatePaymentStatusSchema = z.object({
  status: z.nativeEnum(PaymentStatus),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
export type UpdatePaymentStatusInput = z.infer<typeof updatePaymentStatusSchema>;
export type PaymentMode = z.infer<typeof paymentModeSchema>;
