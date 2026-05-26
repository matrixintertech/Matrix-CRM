import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().optional(),
  AUTH_SECRET: z.string().optional(),
  NEXTAUTH_SECRET: z.string().optional(),
  AUTH_URL: z.string().url().optional(),
  NEXTAUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PHONE: z.string().min(8).optional(),
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_SUPER_ADMIN_PHONE: z.string().min(8).optional(),
  PLATFORM_SERVICE_PARTNER_CODE: z.string().min(1).default("PLATFORM"),
  PLATFORM_SERVICE_PARTNER_NAME: z.string().min(1).default("Platform Tenant"),
  SEED_DEV_TEST_USERS: booleanFromEnv.optional(),
  DEV_TEST_USER_EMAIL: z.string().email().optional(),
  DEV_TEST_USER_PHONE: z.string().min(8).optional(),
  OTP_DEV_MODE: booleanFromEnv.optional(),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).optional(),
  OTP_EXPIRY_SECONDS: z.coerce.number().int().min(30).max(3600).optional(),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).optional(),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).optional(),
  OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(86400).optional(),
  OTP_SEND_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(200).optional(),
  OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(86400).optional(),
  OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(500).optional(),
});

const normalizedEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  IS_PRODUCTION: z.boolean(),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().optional(),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET or NEXTAUTH_SECRET is required"),
  AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PHONE: z.string().min(8).optional(),
  PLATFORM_SERVICE_PARTNER_CODE: z.string().min(1),
  PLATFORM_SERVICE_PARTNER_NAME: z.string().min(1),
  SEED_DEV_TEST_USERS: z.boolean(),
  DEV_TEST_USER_EMAIL: z.string().email().optional(),
  DEV_TEST_USER_PHONE: z.string().min(8).optional(),
  OTP_DEV_MODE: z.boolean(),
  OTP_LENGTH: z.number().int().min(4).max(8),
  OTP_EXPIRY_SECONDS: z.number().int().min(30).max(3600),
  OTP_MAX_ATTEMPTS: z.number().int().min(1).max(10),
  OTP_RESEND_COOLDOWN_SECONDS: z.number().int().min(0).max(3600),
  OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: z.number().int().min(10).max(86400),
  OTP_SEND_RATE_LIMIT_MAX: z.number().int().min(1).max(200),
  OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: z.number().int().min(10).max(86400),
  OTP_VERIFY_RATE_LIMIT_MAX: z.number().int().min(1).max(500),
});

export type Env = z.infer<typeof normalizedEnvSchema>;

let cachedEnv: Env | null = null;

export function env(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = rawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  const data = parsed.data;
  const authSecret = data.AUTH_SECRET ?? data.NEXTAUTH_SECRET;
  if (!authSecret) {
    throw new Error("Invalid environment variables: AUTH_SECRET or NEXTAUTH_SECRET is required");
  }

  const authUrl = data.AUTH_URL ?? data.NEXTAUTH_URL;
  const bootstrapAdminEmail = data.BOOTSTRAP_ADMIN_EMAIL ?? data.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  const bootstrapAdminPhone = data.BOOTSTRAP_ADMIN_PHONE ?? data.BOOTSTRAP_SUPER_ADMIN_PHONE;
  const isProduction = data.NODE_ENV === "production";
  const otpDevMode = data.OTP_DEV_MODE ?? false;

  if (isProduction && otpDevMode) {
    throw new Error("Invalid environment variables: OTP_DEV_MODE cannot be true in production");
  }

  const normalized = normalizedEnvSchema.safeParse({
    NODE_ENV: data.NODE_ENV,
    IS_PRODUCTION: isProduction,
    DATABASE_URL: data.DATABASE_URL,
    DIRECT_URL: data.DIRECT_URL,
    AUTH_SECRET: authSecret,
    AUTH_URL: authUrl,
    NEXT_PUBLIC_APP_URL: data.NEXT_PUBLIC_APP_URL,
    BOOTSTRAP_ADMIN_EMAIL: bootstrapAdminEmail,
    BOOTSTRAP_ADMIN_PHONE: bootstrapAdminPhone,
    PLATFORM_SERVICE_PARTNER_CODE: data.PLATFORM_SERVICE_PARTNER_CODE,
    PLATFORM_SERVICE_PARTNER_NAME: data.PLATFORM_SERVICE_PARTNER_NAME,
    SEED_DEV_TEST_USERS: data.SEED_DEV_TEST_USERS ?? false,
    DEV_TEST_USER_EMAIL: data.DEV_TEST_USER_EMAIL,
    DEV_TEST_USER_PHONE: data.DEV_TEST_USER_PHONE,
    OTP_DEV_MODE: otpDevMode,
    OTP_LENGTH: data.OTP_LENGTH ?? 6,
    OTP_EXPIRY_SECONDS: data.OTP_EXPIRY_SECONDS ?? 300,
    OTP_MAX_ATTEMPTS: data.OTP_MAX_ATTEMPTS ?? 5,
    OTP_RESEND_COOLDOWN_SECONDS: data.OTP_RESEND_COOLDOWN_SECONDS ?? 30,
    OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: data.OTP_SEND_RATE_LIMIT_WINDOW_SECONDS ?? 900,
    OTP_SEND_RATE_LIMIT_MAX: data.OTP_SEND_RATE_LIMIT_MAX ?? 5,
    OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: data.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS ?? 900,
    OTP_VERIFY_RATE_LIMIT_MAX: data.OTP_VERIFY_RATE_LIMIT_MAX ?? 10,
  });

  if (!normalized.success) {
    throw new Error(
      `Invalid normalized environment variables: ${normalized.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`
    );
  }

  cachedEnv = normalized.data;
  return cachedEnv;
}
