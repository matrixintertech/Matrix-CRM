import { z } from "zod";

import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";

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

export const itemUpsertSchema = z.object({
  servicePartnerId: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.union([z.string().uuid(), z.literal(ALL_SERVICE_PARTNERS_OPTION)]).optional()
  ),
  categoryId: z.string().uuid(),
  subcategoryId: z.string().uuid(),
  uomId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  description: optionalString(300),
  active: booleanFromForm.default(true),
});

export const itemActiveSchema = z.object({
  active: booleanFromForm,
});

export type ItemUpsertInput = z.infer<typeof itemUpsertSchema>;
