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

export const createVendorPaymentSchema = z.object({
  servicePartnerId: z.string().uuid().optional(),
  vendorId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  amount: requiredNumber.refine((value) => value > 0, {
    message: "Amount must be greater than 0.",
  }),
  paymentDate: requiredDate,
  notes: optionalString(1200),
  status: z.nativeEnum(PaymentStatus).default(PaymentStatus.PAID),
});

export const updateVendorPaymentSchema = z.object({
  servicePartnerId: z.string().uuid().optional(),
  vendorId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().optional(),
  amount: requiredNumber.refine((value) => value > 0, {
    message: "Amount must be greater than 0.",
  }),
  paymentDate: requiredDate,
  notes: optionalString(1200),
  status: z.nativeEnum(PaymentStatus),
});

export const updateVendorPaymentStatusSchema = z.object({
  status: z.nativeEnum(PaymentStatus),
});

export type CreateVendorPaymentInput = z.infer<typeof createVendorPaymentSchema>;
export type UpdateVendorPaymentInput = z.infer<typeof updateVendorPaymentSchema>;
export type UpdateVendorPaymentStatusInput = z.infer<typeof updateVendorPaymentStatusSchema>;
