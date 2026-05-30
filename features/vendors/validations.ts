import { VendorStatus } from "@prisma/client";
import { z } from "zod";

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

const booleanFromForm = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "on" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "off" || normalized === "0") {
      return false;
    }
  }
  return value;
}, z.boolean());

export const vendorUpsertSchema = z.object({
  servicePartnerId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  email: optionalString(180).refine((value) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: "Email format is invalid.",
  }),
  phone: optionalString(30),
  status: z.nativeEnum(VendorStatus),
  isVerified: booleanFromForm.default(false),
  gstNumber: optionalString(40),
  panNumber: optionalString(30),
  address: optionalString(600),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  postalCode: optionalString(20),
  vendorType: optionalString(80),
});

export const vendorStatusSchema = z.object({
  status: z.nativeEnum(VendorStatus),
  isVerified: booleanFromForm.optional(),
});

export type VendorUpsertInput = z.infer<typeof vendorUpsertSchema>;
