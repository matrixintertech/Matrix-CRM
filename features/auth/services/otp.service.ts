import type { OtpPurpose, UserStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { measurePerf } from "@/lib/observability/perf";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { sendOtpMessage } from "@/features/auth/services/otp-provider.service";
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
  | "RATE_LIMIT_UNAVAILABLE"
  | "OTP_PROVIDER_NOT_CONFIGURED"
  | "OTP_DELIVERY_FAILED"
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

export type VerifyTargetOtpResult =
  | {
      ok: true;
      challenge: {
        id: string;
        servicePartnerId: string;
        userId: string | null;
        target: string;
        purpose: OtpPurpose;
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

function makeRateLimitKey(segment: string, purpose: OtpPurpose, target: string, ipAddress?: string | null): string {
  return `otp:${segment}:${purpose}:${target}:${ipAddress ?? "unknown"}`;
}

function userAllowedForOtp(status: UserStatus, deletedAt: Date | null, servicePartnerId?: string): boolean {
  return status === "ACTIVE" && !deletedAt && Boolean(servicePartnerId);
}

function getUserLookupWhere(normalizedTarget: string, channel: "EMAIL" | "SMS") {
  return channel === "EMAIL" ? { email: normalizedTarget } : { phone: normalizedTarget };
}

export async function sendOtpChallengeToKnownTarget(
  input: { servicePartnerId: string; userId?: string | null; target: string; purpose: OtpPurpose } & ActorContext
): Promise<SendOtpResult> {
  return measurePerf("otp.send_known_target", async () => {
    const otpConfig = getOtpConfig();

    let normalizedTarget: string;
    let channel: "EMAIL" | "SMS";

    try {
      const parsedTarget = normalizeLoginTarget(input.target);
      normalizedTarget = parsedTarget.normalizedTarget;
      channel = resolveOtpChannel(parsedTarget.kind);
    } catch {
      return {
        ok: false,
        code: "OTP_INVALID",
        status: 400,
        message: "Invalid OTP target.",
      } satisfies SendOtpResult;
    }

    const maskedTarget = maskOtpTarget(normalizedTarget);
    const sendRateLimit = await consumeRateLimit(
      makeRateLimitKey("send", input.purpose, normalizedTarget, input.ipAddress),
      otpConfig.sendRateLimitWindowSeconds,
      otpConfig.sendRateLimitMax
    );

    if (sendRateLimit.reason === "backend_unavailable") {
      return {
        ok: false,
        code: "RATE_LIMIT_UNAVAILABLE",
        status: 503,
        message: "OTP is temporarily unavailable. Please try again shortly.",
        retryAfterSeconds: sendRateLimit.retryAfterSeconds,
        maskedTarget,
      } satisfies SendOtpResult;
    }

    if (!sendRateLimit.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many OTP requests. Please try again later.",
        retryAfterSeconds: sendRateLimit.retryAfterSeconds,
        maskedTarget,
      } satisfies SendOtpResult;
    }

    const latestChallenge = await prisma.otpChallenge.findFirst({
      where: {
        servicePartnerId: input.servicePartnerId,
        target: normalizedTarget,
        purpose: input.purpose,
        userId: input.userId ?? null,
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
        } satisfies SendOtpResult;
      }
    }

    const code = makeOtpCode();
    const expiresAt = new Date(Date.now() + otpConfig.expirySeconds * 1000);

    const challenge = await prisma.otpChallenge.create({
      data: {
        servicePartnerId: input.servicePartnerId,
        userId: input.userId ?? null,
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

    const delivery = await sendOtpMessage({
      channel,
      target: normalizedTarget,
      code,
      purpose: input.purpose,
    });

    if (!delivery.ok) {
      await prisma.otpChallenge.delete({ where: { id: challenge.id } });

      return {
        ok: false,
        code: delivery.code === "PROVIDER_NOT_CONFIGURED" ? "OTP_PROVIDER_NOT_CONFIGURED" : "OTP_DELIVERY_FAILED",
        status: delivery.code === "PROVIDER_NOT_CONFIGURED" ? 503 : 502,
        message:
          delivery.code === "PROVIDER_NOT_CONFIGURED"
            ? "OTP delivery is temporarily unavailable. Please contact support."
            : "Unable to deliver OTP right now. Please try again.",
        maskedTarget,
      } satisfies SendOtpResult;
    }

    return {
      ok: true,
      maskedTarget,
      expiresInSeconds: otpConfig.expirySeconds,
      resendAfterSeconds: otpConfig.resendCooldownSeconds,
      ...(env().OTP_DEV_MODE && !env().IS_PRODUCTION && delivery.mode === "dev" ? { devOtpPreview: code } : {}),
    } satisfies SendOtpResult;
  });
}

export async function sendOtpChallenge(
  input: { target: string; purpose: OtpPurpose } & ActorContext
): Promise<SendOtpResult> {
  return measurePerf("otp.send", async () => {
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
      } satisfies SendOtpResult;
    }

    const maskedTarget = maskOtpTarget(normalizedTarget);

    const sendRateLimit = await consumeRateLimit(
      makeRateLimitKey("send", input.purpose, normalizedTarget, input.ipAddress),
      otpConfig.sendRateLimitWindowSeconds,
      otpConfig.sendRateLimitMax
    );

    if (sendRateLimit.reason === "backend_unavailable") {
      return {
        ok: false,
        code: "RATE_LIMIT_UNAVAILABLE",
        status: 503,
        message: "OTP is temporarily unavailable. Please try again shortly.",
        retryAfterSeconds: sendRateLimit.retryAfterSeconds,
        maskedTarget,
      } satisfies SendOtpResult;
    }

    if (!sendRateLimit.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many OTP requests. Please try again later.",
        retryAfterSeconds: sendRateLimit.retryAfterSeconds,
        maskedTarget,
      } satisfies SendOtpResult;
    }

    const user = await prisma.user.findFirst({
      where: {
        deletedAt: null,
        status: "ACTIVE",
        ...getUserLookupWhere(normalizedTarget, channel),
      },
      select: {
        id: true,
        email: true,
        servicePartnerId: true,
      },
    });

    if (!user?.servicePartnerId) {
      return {
        ok: true,
        maskedTarget,
        expiresInSeconds: otpConfig.expirySeconds,
        resendAfterSeconds: otpConfig.resendCooldownSeconds,
      } satisfies SendOtpResult;
    }

    const config = env();
    let deliveryChannel: "EMAIL" | "SMS";
    let deliveryTarget: string;

    if (config.OTP_DELIVERY_CHANNEL === "email") {
      deliveryChannel = "EMAIL";
      deliveryTarget = channel === "EMAIL" ? normalizedTarget : user.email?.trim().toLowerCase() ?? "";
    } else {
      deliveryChannel = channel;
      deliveryTarget = normalizedTarget;
    }

    if (!deliveryTarget) {
      return {
        ok: false,
        code: "OTP_PROVIDER_NOT_CONFIGURED",
        status: 503,
        message: "OTP delivery is temporarily unavailable. Please contact support.",
        maskedTarget,
      } satisfies SendOtpResult;
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
        } satisfies SendOtpResult;
      }
    }

    const code = makeOtpCode();
    const expiresAt = new Date(Date.now() + otpConfig.expirySeconds * 1000);

    const challenge = await prisma.otpChallenge.create({
      data: {
        servicePartnerId: user.servicePartnerId,
        userId: user.id,
        purpose: input.purpose,
        channel: deliveryChannel,
        target: normalizedTarget,
        codeHash: hashOtpCode(normalizedTarget, input.purpose, code),
        expiresAt,
        maxAttempts: otpConfig.maxAttempts,
        ipAddress: input.ipAddress?.slice(0, 128) ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
      select: { id: true },
    });

    const delivery = await sendOtpMessage({
      channel: deliveryChannel,
      target: deliveryTarget,
      code,
      purpose: input.purpose,
    });

    if (!delivery.ok) {
      await prisma.otpChallenge.delete({ where: { id: challenge.id } });

      if (delivery.code === "PROVIDER_NOT_CONFIGURED") {
        return {
          ok: false,
          code: "OTP_PROVIDER_NOT_CONFIGURED",
          status: 503,
          message: "OTP delivery is temporarily unavailable. Please contact support.",
          maskedTarget,
        } satisfies SendOtpResult;
      }

      return {
        ok: false,
        code: "OTP_DELIVERY_FAILED",
        status: 502,
        message: "Unable to deliver OTP right now. Please try again.",
        maskedTarget,
      } satisfies SendOtpResult;
    }

    return {
      ok: true,
      maskedTarget,
      expiresInSeconds: otpConfig.expirySeconds,
      resendAfterSeconds: otpConfig.resendCooldownSeconds,
      ...(config.OTP_DEV_MODE && !config.IS_PRODUCTION && delivery.ok && delivery.mode === "dev"
        ? { devOtpPreview: code }
        : {}),
    } satisfies SendOtpResult;
  });
}

export async function verifyOtpForLogin(
  input: { target: string; purpose: OtpPurpose; code: string } & ActorContext
): Promise<VerifyOtpResult> {
  return measurePerf("otp.verify_login", async () => {
    if (!isLoginPurpose(input.purpose)) {
      return {
        ok: false,
        code: "OTP_INVALID",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyOtpResult;
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
      } satisfies VerifyOtpResult;
    }

    const otpConfig = getOtpConfig();
    const verifyRateLimit = await consumeRateLimit(
      makeRateLimitKey("verify", input.purpose, normalizedTarget, input.ipAddress),
      otpConfig.verifyRateLimitWindowSeconds,
      otpConfig.verifyRateLimitMax
    );

    if (verifyRateLimit.reason === "backend_unavailable") {
      return {
        ok: false,
        code: "RATE_LIMIT_UNAVAILABLE",
        status: 503,
        message: "OTP verification is temporarily unavailable. Please try again shortly.",
        retryAfterSeconds: verifyRateLimit.retryAfterSeconds,
      } satisfies VerifyOtpResult;
    }

    if (!verifyRateLimit.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many OTP verification attempts. Please try again later.",
        retryAfterSeconds: verifyRateLimit.retryAfterSeconds,
      } satisfies VerifyOtpResult;
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
              where: {
                role: {
                  deletedAt: null,
                },
              },
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
      } satisfies VerifyOtpResult;
    }

    const now = new Date();

    if (challenge.consumedAt) {
      return {
        ok: false,
        code: "OTP_CONSUMED",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyOtpResult;
    }

    if (challenge.expiresAt.getTime() < now.getTime()) {
      return {
        ok: false,
        code: "OTP_EXPIRED",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyOtpResult;
    }

    if (challenge.attemptCount >= challenge.maxAttempts) {
      return {
        ok: false,
        code: "OTP_ATTEMPTS_EXCEEDED",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyOtpResult;
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
      } satisfies VerifyOtpResult;
    }

    const user = challenge.user;
    if (!user || !userAllowedForOtp(user.status, user.deletedAt, user.servicePartnerId)) {
      return {
        ok: false,
        code: "USER_NOT_ALLOWED",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyOtpResult;
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
    } satisfies VerifyOtpResult;
  });
}

export async function verifyOtpForTarget(
  input: { target: string; purpose: OtpPurpose; code: string; userId?: string | null } & ActorContext
): Promise<VerifyTargetOtpResult> {
  return measurePerf("otp.verify_target", async () => {
    let normalizedTarget: string;

    try {
      normalizedTarget = normalizeLoginTarget(input.target).normalizedTarget;
    } catch {
      return {
        ok: false,
        code: "OTP_INVALID",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyTargetOtpResult;
    }

    const otpConfig = getOtpConfig();
    const verifyRateLimit = await consumeRateLimit(
      makeRateLimitKey("verify", input.purpose, normalizedTarget, input.ipAddress),
      otpConfig.verifyRateLimitWindowSeconds,
      otpConfig.verifyRateLimitMax
    );

    if (verifyRateLimit.reason === "backend_unavailable") {
      return {
        ok: false,
        code: "RATE_LIMIT_UNAVAILABLE",
        status: 503,
        message: "OTP verification is temporarily unavailable. Please try again shortly.",
        retryAfterSeconds: verifyRateLimit.retryAfterSeconds,
      } satisfies VerifyTargetOtpResult;
    }

    if (!verifyRateLimit.allowed) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        status: 429,
        message: "Too many OTP verification attempts. Please try again later.",
        retryAfterSeconds: verifyRateLimit.retryAfterSeconds,
      } satisfies VerifyTargetOtpResult;
    }

    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        target: normalizedTarget,
        purpose: input.purpose,
        consumedAt: null,
        ...(input.userId ? { userId: input.userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        servicePartnerId: true,
        userId: true,
        target: true,
        purpose: true,
        codeHash: true,
        expiresAt: true,
        consumedAt: true,
        attemptCount: true,
        maxAttempts: true,
      },
    });

    if (!challenge) {
      return {
        ok: false,
        code: "OTP_INVALID",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyTargetOtpResult;
    }

    const now = new Date();
    if (challenge.expiresAt.getTime() < now.getTime()) {
      return {
        ok: false,
        code: "OTP_EXPIRED",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyTargetOtpResult;
    }

    if (challenge.attemptCount >= challenge.maxAttempts) {
      return {
        ok: false,
        code: "OTP_ATTEMPTS_EXCEEDED",
        status: 401,
        message: OTP_GENERIC_VERIFY_MESSAGE,
      } satisfies VerifyTargetOtpResult;
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
      } satisfies VerifyTargetOtpResult;
    }

    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: now,
        lastAttemptAt: now,
      },
    });

    return {
      ok: true,
      challenge: {
        id: challenge.id,
        servicePartnerId: challenge.servicePartnerId,
        userId: challenge.userId,
        target: challenge.target,
        purpose: challenge.purpose,
      },
    } satisfies VerifyTargetOtpResult;
  });
}

export const otpMessages = {
  genericSend: OTP_GENERIC_SEND_MESSAGE,
};

export const verifyOtpChallenge = verifyOtpForLogin;
