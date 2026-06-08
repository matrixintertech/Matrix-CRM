import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";

import { baselineSettings } from "@/lib/rbac/baseline";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/config/env";
import { invalidateTenantDataCaches } from "@/lib/cache/cache-invalidation";
import type { SettingsUpdateInput } from "@/features/settings/validations";

type SettingKey =
  | "app.timezone"
  | "otp.expiry_seconds"
  | "otp.max_attempts"
  | "otp.resend_cooldown_seconds";

type SettingRecord = {
  key: string;
  value: Prisma.JsonValue;
  isSecret: boolean;
};

function getScopedServicePartnerId(session: Session) {
  return session.user.servicePartnerId;
}

function getDefaultSettingMap() {
  return new Map(baselineSettings.map((setting) => [setting.key, setting]));
}

function getObjectValue(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function getStringSetting(settingsByKey: Map<string, SettingRecord>, key: SettingKey, valueKey: string, fallback: string) {
  const raw = getObjectValue(settingsByKey.get(key)?.value)[valueKey];
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

function getNumberSetting(settingsByKey: Map<string, SettingRecord>, key: SettingKey, valueKey: string, fallback: number) {
  const raw = getObjectValue(settingsByKey.get(key)?.value)[valueKey];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
}

export async function getSettingsPageData(session: Session) {
  const servicePartnerId = getScopedServicePartnerId(session);
  if (!servicePartnerId) {
    return null;
  }

  const [servicePartner, settings] = await Promise.all([
    prisma.servicePartner.findFirst({
      where: {
        id: servicePartnerId,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        legalName: true,
        status: true,
      },
    }),
    prisma.setting.findMany({
      where: {
        servicePartnerId,
        key: {
          in: [
            "app.timezone",
            "otp.expiry_seconds",
            "otp.max_attempts",
            "otp.resend_cooldown_seconds",
          ],
        },
      },
      select: {
        key: true,
        value: true,
        isSecret: true,
      },
      orderBy: [{ key: "asc" }],
    }),
  ]);

  if (!servicePartner) {
    return null;
  }

  const defaults = getDefaultSettingMap();
  const settingsByKey = new Map<string, SettingRecord>(
    settings.map((setting) => [setting.key, setting])
  );

  const timezoneDefault = getObjectValue(defaults.get("app.timezone")?.value as Prisma.JsonValue | undefined).timezone;
  const otpExpiryDefault = getObjectValue(defaults.get("otp.expiry_seconds")?.value as Prisma.JsonValue | undefined).seconds;
  const otpAttemptsDefault = getObjectValue(defaults.get("otp.max_attempts")?.value as Prisma.JsonValue | undefined).attempts;
  const otpCooldownDefault = getObjectValue(defaults.get("otp.resend_cooldown_seconds")?.value as Prisma.JsonValue | undefined).seconds;

  return {
    servicePartner,
    editable: {
      timezone: getStringSetting(settingsByKey, "app.timezone", "timezone", typeof timezoneDefault === "string" ? timezoneDefault : "Asia/Kolkata"),
      otpExpirySeconds: getNumberSetting(settingsByKey, "otp.expiry_seconds", "seconds", typeof otpExpiryDefault === "number" ? otpExpiryDefault : 300),
      otpMaxAttempts: getNumberSetting(settingsByKey, "otp.max_attempts", "attempts", typeof otpAttemptsDefault === "number" ? otpAttemptsDefault : 5),
      otpResendCooldownSeconds: getNumberSetting(
        settingsByKey,
        "otp.resend_cooldown_seconds",
        "seconds",
        typeof otpCooldownDefault === "number" ? otpCooldownDefault : 30
      ),
    },
    system: {
      otpDeliveryChannel: env().OTP_DELIVERY_CHANNEL,
      taskLocationRequired: env().TASK_LOCATION_REQUIRED,
      taskAttachmentMaxMb: env().TASK_ATTACHMENT_MAX_MB,
      storageDriver: env().STORAGE_DRIVER,
      smtpConfigured: env().SMTP_CONFIGURED,
      cacheDriver: env().CACHE_DRIVER,
      rateLimitDriver: env().RATE_LIMIT_DRIVER,
    },
  };
}

export async function updateTenantSettings(session: Session, input: SettingsUpdateInput) {
  const servicePartnerId = getScopedServicePartnerId(session);
  if (!servicePartnerId) {
    throw new Error("Service partner scope is missing for this user.");
  }

  const servicePartner = await prisma.servicePartner.findFirst({
    where: {
      id: servicePartnerId,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!servicePartner) {
    throw new Error("Service partner not found.");
  }

  await prisma.$transaction([
    prisma.setting.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId,
          key: "app.timezone",
        },
      },
      update: {
        value: { timezone: input.timezone } as Prisma.InputJsonValue,
        isSecret: false,
      },
      create: {
        servicePartnerId,
        key: "app.timezone",
        value: { timezone: input.timezone } as Prisma.InputJsonValue,
        isSecret: false,
      },
    }),
    prisma.setting.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId,
          key: "otp.expiry_seconds",
        },
      },
      update: {
        value: { seconds: input.otpExpirySeconds } as Prisma.InputJsonValue,
        isSecret: false,
      },
      create: {
        servicePartnerId,
        key: "otp.expiry_seconds",
        value: { seconds: input.otpExpirySeconds } as Prisma.InputJsonValue,
        isSecret: false,
      },
    }),
    prisma.setting.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId,
          key: "otp.max_attempts",
        },
      },
      update: {
        value: { attempts: input.otpMaxAttempts } as Prisma.InputJsonValue,
        isSecret: false,
      },
      create: {
        servicePartnerId,
        key: "otp.max_attempts",
        value: { attempts: input.otpMaxAttempts } as Prisma.InputJsonValue,
        isSecret: false,
      },
    }),
    prisma.setting.upsert({
      where: {
        servicePartnerId_key: {
          servicePartnerId,
          key: "otp.resend_cooldown_seconds",
        },
      },
      update: {
        value: { seconds: input.otpResendCooldownSeconds } as Prisma.InputJsonValue,
        isSecret: false,
      },
      create: {
        servicePartnerId,
        key: "otp.resend_cooldown_seconds",
        value: { seconds: input.otpResendCooldownSeconds } as Prisma.InputJsonValue,
        isSecret: false,
      },
    }),
  ]);

  await invalidateTenantDataCaches(servicePartnerId);
  return servicePartner;
}
