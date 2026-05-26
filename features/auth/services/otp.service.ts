import type { OtpPurpose, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  getOtpConfig,
  hashOtpCode,
  isLoginPurpose,
  makeOtpCode,
  maskOtpTarget,
  normalizeLoginTarget,
  resolveOtpChannel,
  verifyOtpCodeHash,
} from "@/lib/security/otp";

type ActorContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type OtpErrorCode =
  | "RATE_LIMITED"
  | "OTP_PROVIDER_NOT_CONFIGURED"
  | "OTP_COOLDOWN"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_CONSUMED"
  | "OTP_ATTEMPTS_EXCEEDED"
  | "USER_NOT_ALLOWED";

export type SendOtpResult =
  | {
      ok: true;
      maskedTarget: string;
      expiresInSeconds: number;
      resendAfterSeconds: number;
      devOtpPreview?: string;
    }
  | {
      ok: false;
      code: OtpErrorCode;
      status: number;
      message: string;
      retryAfterSeconds?: number;
      maskedTarget?: string;
    };

export type VerifyOtpResult =
  | {
      ok: true;
      user: {
        id: string;
        servicePartnerId: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        status: UserStatus;
        roleKeys: string[];
        isSuperAdmin: boolean;
      };
    }
  | {
      ok: false;
      code: OtpErrorCode;
      status: number;
      message: string;
      retryAfterSeconds?: number;
    };

const OTP_GENERIC_SEND_MESSAGE = "If this account exists, an OTP has been sent.";
const OTP_GENERIC_VERIFY_MESSAGE = "Invalid or expired OTP.";

type DeliveryOutcome = {
  delivered: boolean;
  devOtpPreview?: string;
};

async function sendOtpViaProvider(
  channel: "EMAIL" | "SMS",
  target: string,
  code: string
): Promise<DeliveryOutcome> {
  const config = env();

  if (config.IS_PRODUCTION) {
    return { delivered: false };
  }

  if (config.OTP_DEV_MODE) {
    return { delivered: true, devOtpPreview: code };
  }

  const _unused = { channel, target, code };
  return { delivered: false };
}

function makeRateLimitKey(segment: string, purpose: OtpPurpose, target: string, ipAddress?: string | null): string {
  return `otp:${segment}:${purpose}:${target}:${ipAddress ?? "unknown"}`;
}

function userAllowedForOtp(status: UserStatus, deletedAt: Date | null, servicePartnerId?: string): boolean {
  return status === "ACTIVE" && !deletedAt && Boolean(servicePartnerId);
}

export async function sendOtpChallenge(
  input: { target: string; purpose: OtpPurpose } & ActorContext
): Promise<SendOtpResult> {
  const otpConfig = getOtpConfig();

  let normalizedTarget: string;
  let channel: "EMAIL" | "SMS";

  try {
    const parsedTarget = normalizeLoginTarget(input.target);
    normalizedTarget = parsedTarget.normalizedTarget;
    channel = resolveOtpChannel(parsedTarget.kind);
  } catch {
    return {
      ok: true,
      maskedTarget: maskOtpTarget(input.target.trim() || "********"),
      expiresInSeconds: otpConfig.expirySeconds,
      resendAfterSeconds: otpConfig.resendCooldownSeconds,
    };
  }

  const maskedTarget = maskOtpTarget(normalizedTarget);

  const sendRateLimit = consumeRateLimit(
    makeRateLimitKey("send", input.purpose, normalizedTarget, input.ipAddress),
    otpConfig.sendRateLimitWindowSeconds,
    otpConfig.sendRateLimitMax
  );

  if (!sendRateLimit.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many OTP requests. Please try again later.",
      retryAfterSeconds: sendRateLimit.retryAfterSeconds,
      maskedTarget,
    };
  }

  if (env().IS_PRODUCTION) {
    return {
      ok: false,
      code: "OTP_PROVIDER_NOT_CONFIGURED",
      status: 500,
      message: "OTP provider is not configured.",
      maskedTarget,
    };
  }

  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      OR: [{ email: normalizedTarget }, { phone: normalizedTarget }],
    },
    select: {
      id: true,
      servicePartnerId: true,
    },
  });

  if (!user?.servicePartnerId) {
    return {
      ok: true,
      maskedTarget,
      expiresInSeconds: otpConfig.expirySeconds,
      resendAfterSeconds: otpConfig.resendCooldownSeconds,
    };
  }

  const latestChallenge = await prisma.otpChallenge.findFirst({
    where: {
      target: normalizedTarget,
      purpose: input.purpose,
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
    },
  });

  if (latestChallenge) {
    const cooldownRemaining =
      otpConfig.resendCooldownSeconds - Math.floor((Date.now() - latestChallenge.createdAt.getTime()) / 1000);

    if (cooldownRemaining > 0) {
      return {
        ok: false,
        code: "OTP_COOLDOWN",
        status: 429,
        message: "Please wait before requesting another OTP.",
        retryAfterSeconds: cooldownRemaining,
        maskedTarget,
      };
    }
  }

  const code = makeOtpCode();
  const expiresAt = new Date(Date.now() + otpConfig.expirySeconds * 1000);

  const challenge = await prisma.otpChallenge.create({
    data: {
      servicePartnerId: user.servicePartnerId,
      userId: user.id,
      purpose: input.purpose,
      channel,
      target: normalizedTarget,
      codeHash: hashOtpCode(normalizedTarget, input.purpose, code),
      expiresAt,
      maxAttempts: otpConfig.maxAttempts,
      ipAddress: input.ipAddress?.slice(0, 128) ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    },
    select: { id: true },
  });

  const delivery = await sendOtpViaProvider(channel, normalizedTarget, code);

  if (!delivery.delivered) {
    await prisma.otpChallenge.delete({ where: { id: challenge.id } });
    return {
      ok: false,
      code: "OTP_PROVIDER_NOT_CONFIGURED",
      status: 500,
      message: "OTP provider is not configured.",
      maskedTarget,
    };
  }

  return {
    ok: true,
    maskedTarget,
    expiresInSeconds: otpConfig.expirySeconds,
    resendAfterSeconds: otpConfig.resendCooldownSeconds,
    ...(env().OTP_DEV_MODE && !env().IS_PRODUCTION && delivery.devOtpPreview
      ? { devOtpPreview: delivery.devOtpPreview }
      : {}),
  };
}

export async function verifyOtpForLogin(
  input: { target: string; purpose: OtpPurpose; code: string } & ActorContext
): Promise<VerifyOtpResult> {
  if (!isLoginPurpose(input.purpose)) {
    return {
      ok: false,
      code: "OTP_INVALID",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  let normalizedTarget: string;

  try {
    normalizedTarget = normalizeLoginTarget(input.target).normalizedTarget;
  } catch {
    return {
      ok: false,
      code: "OTP_INVALID",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  const otpConfig = getOtpConfig();
  const verifyRateLimit = consumeRateLimit(
    makeRateLimitKey("verify", input.purpose, normalizedTarget, input.ipAddress),
    otpConfig.verifyRateLimitWindowSeconds,
    otpConfig.verifyRateLimitMax
  );

  if (!verifyRateLimit.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many OTP verification attempts. Please try again later.",
      retryAfterSeconds: verifyRateLimit.retryAfterSeconds,
    };
  }

  const challenge = await prisma.otpChallenge.findFirst({
    where: {
      target: normalizedTarget,
      purpose: input.purpose,
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: {
          id: true,
          servicePartnerId: true,
          name: true,
          email: true,
          phone: true,
          status: true,
          deletedAt: true,
          roles: {
            select: {
              role: {
                select: {
                  key: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!challenge) {
    return {
      ok: false,
      code: "OTP_INVALID",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  const now = new Date();

  if (challenge.consumedAt) {
    return {
      ok: false,
      code: "OTP_CONSUMED",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  if (challenge.expiresAt.getTime() < now.getTime()) {
    return {
      ok: false,
      code: "OTP_EXPIRED",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  if (challenge.attemptCount >= challenge.maxAttempts) {
    return {
      ok: false,
      code: "OTP_ATTEMPTS_EXCEEDED",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  const isValid = verifyOtpCodeHash(normalizedTarget, input.purpose, input.code, challenge.codeHash);
  if (!isValid) {
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
      },
    });

    return {
      ok: false,
      code: "OTP_INVALID",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  const user = challenge.user;
  if (!user || !userAllowedForOtp(user.status, user.deletedAt, user.servicePartnerId)) {
    return {
      ok: false,
      code: "USER_NOT_ALLOWED",
      status: 401,
      message: OTP_GENERIC_VERIFY_MESSAGE,
    };
  }

  const roleKeys = user.roles.map((entry) => entry.role.key);
  const isSuperAdmin = roleKeys.includes("super_admin");

  await prisma.$transaction([
    prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: now,
        lastAttemptAt: now,
      },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    }),
  ]);

  return {
    ok: true,
    user: {
      id: user.id,
      servicePartnerId: user.servicePartnerId,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      roleKeys,
      isSuperAdmin,
    },
  };
}

export const otpMessages = {
  genericSend: OTP_GENERIC_SEND_MESSAGE,
};

export const verifyOtpChallenge = verifyOtpForLogin;
