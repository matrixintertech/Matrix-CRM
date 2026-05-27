import { z } from "zod";

const optionalString = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional()
  );

export const branchUpsertSchema = z.object({
  servicePartnerId: z.string().uuid(),
  clientId: z.string().uuid(),
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(180),
  address: optionalString(300),
  city: optionalString(80),
  state: optionalString(80),
  country: optionalString(80),
  postalCode: optionalString(20),
});

export type BranchUpsertInput = z.infer<typeof branchUpsertSchema>;
