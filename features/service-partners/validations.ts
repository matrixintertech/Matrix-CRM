import { ServicePartnerStatus } from "@prisma/client";
import { z } from "zod";

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().email().optional()
);

export const servicePartnerUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, "Use uppercase letters, numbers, hyphen, or underscore."),
  name: z.string().trim().min(2).max(160),
  legalName: optionalString(160),
  email: optionalEmail,
  phone: optionalString(30),
  address: optionalString(300),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  postalCode: optionalString(20),
  status: z.nativeEnum(ServicePartnerStatus).default(ServicePartnerStatus.ACTIVE),
});

export const servicePartnerStatusSchema = z.object({
  status: z.nativeEnum(ServicePartnerStatus),
});

export type ServicePartnerUpsertInput = z.infer<typeof servicePartnerUpsertSchema>;
