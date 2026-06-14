import { z } from "zod";

import { ALL_SERVICE_PARTNERS_OPTION } from "@/lib/service-partners/constants";

const optionalDescription = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(300).optional()
);

const subcategoryServicePartnerSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.union([z.string().uuid(), z.literal(ALL_SERVICE_PARTNERS_OPTION)]).optional()
);

export const subcategoryUpsertSchema = z.object({
  servicePartnerId: subcategoryServicePartnerSchema,
  categoryId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  description: optionalDescription,
});

export type SubcategoryUpsertInput = z.infer<typeof subcategoryUpsertSchema>;
