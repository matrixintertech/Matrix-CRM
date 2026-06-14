import { z } from "zod";

import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";

const optionalDescription = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(300).optional()
);

const booleanFromForm = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}, z.boolean());

const uomServicePartnerSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.union([z.string().uuid(), z.literal(ALL_SERVICE_PARTNERS_OPTION)]).optional()
);

export const uomUpsertSchema = z.object({
  servicePartnerId: uomServicePartnerSchema,
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  symbol: z.string().trim().min(1).max(20),
  description: optionalDescription,
  active: booleanFromForm.default(true),
});

export type UomUpsertInput = z.infer<typeof uomUpsertSchema>;
