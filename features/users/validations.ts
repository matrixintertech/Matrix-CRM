import { UserStatus } from "@prisma/client";
import { z } from "zod";

const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().email().optional()
);

const optionalPhone = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(8).max(20).optional()
);

export const userUpsertSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    email: optionalEmail,
    phone: optionalPhone,
    servicePartnerId: z.string().uuid(),
    status: z.nativeEnum(UserStatus).default(UserStatus.ACTIVE),
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "Email or phone is required.",
    path: ["email"],
  });

export const userStatusSchema = z.object({
  status: z.nativeEnum(UserStatus),
});

export const userRoleSchema = z.object({
  roleId: z.string().uuid(),
});

export type UserUpsertInput = z.infer<typeof userUpsertSchema>;
