import { ClientStatus } from "@prisma/client";
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

export const clientUpsertSchema = z.object({
  servicePartnerId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  legalName: optionalString(180),
  email: optionalEmail,
  phone: optionalString(30),
  address: optionalString(300),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  postalCode: optionalString(20),
  status: z.nativeEnum(ClientStatus).default(ClientStatus.ACTIVE),
});

export const clientStatusSchema = z.object({
  status: z.nativeEnum(ClientStatus),
});

export type ClientUpsertInput = z.infer<typeof clientUpsertSchema>;
