import { z } from "zod";

const otpPurposeValues = ["LOGIN", "ADMIN_LOGIN", "PASSWORD_RESET"] as const;

export const otpPurposeSchema = z.enum(otpPurposeValues);

export const targetSchema = z
  .string()
  .trim()
  .min(3, "Target is required")
  .max(128, "Target is too long");

export const otpSendSchema = z.object({
  target: targetSchema,
  purpose: otpPurposeSchema.default("LOGIN"),
});

export const otpVerifySchema = z.object({
  target: targetSchema,
  purpose: otpPurposeSchema.default("LOGIN"),
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "OTP must be 4 to 8 digits"),
});

export const loginSchema = otpVerifySchema.extend({
  callbackUrl: z.string().trim().optional(),
});

export type OtpSendInput = z.infer<typeof otpSendSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
