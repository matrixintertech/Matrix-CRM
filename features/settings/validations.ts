import { z } from "zod";

export const settingsUpdateSchema = z.object({
  timezone: z.string().trim().min(1).max(80),
  otpExpirySeconds: z.coerce.number().int().min(30).max(3600),
  otpMaxAttempts: z.coerce.number().int().min(1).max(10),
  otpResendCooldownSeconds: z.coerce.number().int().min(0).max(3600),
});

export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
