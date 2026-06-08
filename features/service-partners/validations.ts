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

const optionalIfsc = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(20).regex(/^[A-Z]{4}0[A-Z0-9]{6}$/i, "Enter a valid IFSC code.").optional()
);

const optionalGstNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i, "Enter a valid GST number.")
    .optional()
);

const optionalBankAccountNumber = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .string()
    .trim()
    .min(6, "Enter a valid account number.")
    .max(34)
    .regex(/^[0-9]+$/, "Account number should contain digits only.")
    .optional()
);

export const servicePartnerUpsertSchema = z
  .object({
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
    gstNumber: optionalGstNumber,
    shortProfile: optionalString(600),
    bankName: optionalString(160),
    bankBranch: optionalString(160),
    bankIfscCode: optionalIfsc,
    bankAccountNumber: optionalBankAccountNumber,
    address: optionalString(300),
    city: optionalString(80),
    state: optionalString(80),
    country: optionalString(80),
    postalCode: optionalString(20),
    status: z.nativeEnum(ServicePartnerStatus).default(ServicePartnerStatus.ACTIVE),
  })
  .superRefine((value, context) => {
    if (value.city && !value.state) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "State is required when city is selected.",
      });
    }
  });

export const servicePartnerStatusSchema = z.object({
  status: z.nativeEnum(ServicePartnerStatus),
});

export type ServicePartnerUpsertInput = z.infer<typeof servicePartnerUpsertSchema>;
