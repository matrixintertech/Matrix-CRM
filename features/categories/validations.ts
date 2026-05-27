import { z } from "zod";

const optionalDescription = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(300).optional()
);

export const categoryUpsertSchema = z.object({
  servicePartnerId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  description: optionalDescription,
});

export type CategoryUpsertInput = z.infer<typeof categoryUpsertSchema>;

