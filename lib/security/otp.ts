import type { OtpChannel, OtpPurpose } from "@prisma/client";

import { env } from "@/lib/config/env";
import { createOtpHash, generateNumericOtp, timingSafeHashCompare } from "@/lib/security/crypto";
import { maskTarget } from "@/lib/security/mask";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^\+?[1-9]\d{7,14}$/;

export type TargetKind = "email" | "phone";

export type NormalizedTarget = {
  kind: TargetKind;
  normalizedTarget: string;
};

export function normalizeLoginTarget(target: string): NormalizedTarget {
  const trimmed = target.trim();

  if (trimmed.includes("@")) {
    const normalizedEmail = trimmed.toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      throw new Error("invalid_target");
    }

    return { kind: "email", normalizedTarget: normalizedEmail };
  }

  const normalizedPhone = trimmed.replace(/\s+/g, "");
  if (!phoneRegex.test(normalizedPhone)) {
    throw new Error("invalid_target");
  }

  return { kind: "phone", normalizedTarget: normalizedPhone };
}

export function resolveOtpChannel(targetKind: TargetKind): OtpChannel {
  return targetKind === "email" ? "EMAIL" : "SMS";
}

export function makeOtpCode(): string {
  return generateNumericOtp(env().OTP_LENGTH);
}

export function hashOtpCode(target: string, purpose: OtpPurpose, code: string): string {
  return createOtpHash({
    secret: env().AUTH_SECRET,
    target,
    purpose,
    code,
  });
}

export function verifyOtpCodeHash(target: string, purpose: OtpPurpose, code: string, codeHash: string): boolean {
  const candidate = hashOtpCode(target, purpose, code);
  return timingSafeHashCompare(candidate, codeHash);
}

export function getOtpConfig() {
  const config = env();

  return {
    devMode: config.OTP_DEV_MODE,
    length: config.OTP_LENGTH,
    expirySeconds: config.OTP_EXPIRY_SECONDS,
    maxAttempts: config.OTP_MAX_ATTEMPTS,
    resendCooldownSeconds: config.OTP_RESEND_COOLDOWN_SECONDS,
    sendRateLimitWindowSeconds: config.OTP_SEND_RATE_LIMIT_WINDOW_SECONDS,
    sendRateLimitMax: config.OTP_SEND_RATE_LIMIT_MAX,
    verifyRateLimitWindowSeconds: config.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
    verifyRateLimitMax: config.OTP_VERIFY_RATE_LIMIT_MAX,
  };
}

export function maskOtpTarget(target: string): string {
  return maskTarget(target);
}

export function isLoginPurpose(purpose: OtpPurpose): boolean {
  return purpose === "LOGIN" || purpose === "ADMIN_LOGIN";
}
