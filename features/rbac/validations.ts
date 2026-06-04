import { RoleScope } from "@prisma/client";
import { z } from "zod";

const optionalDescription = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(300).optional()
);

export const roleUpsertSchema = z.object({
  name: z.string().trim().min(2).max(120),
  key: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers, and underscores only."),
  description: optionalDescription,
  scope: z.nativeEnum(RoleScope).default(RoleScope.TENANT),
  level: z.coerce.number().int().min(0).max(1000),
  servicePartnerId: z.string().uuid(),
});

export const rolePermissionSchema = z.object({
  permissionId: z.string().uuid(),
});

export type RoleUpsertInput = z.infer<typeof roleUpsertSchema>;
