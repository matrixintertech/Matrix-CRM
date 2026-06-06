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

const otpDeliveryChannelSchema = z.enum(["email", "sms"]);
const rateLimitDriverSchema = z.enum(["memory", "upstash"]);

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
  OTP_DELIVERY_CHANNEL: otpDeliveryChannelSchema.optional(),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).optional(),
  OTP_EXPIRY_SECONDS: z.coerce.number().int().min(30).max(3600).optional(),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).optional(),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).max(3600).optional(),
  OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(86400).optional(),
  OTP_SEND_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(200).optional(),
  OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(86400).optional(),
  OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(500).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: booleanFromEnv.optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  EMAIL_HOST: z.string().min(1).optional(),
  EMAIL_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  EMAIL_SECURE: booleanFromEnv.optional(),
  EMAIL_USER: z.string().min(1).optional(),
  EMAIL_PASS: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  RATE_LIMIT_DRIVER: rateLimitDriverSchema.optional(),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: booleanFromEnv.optional(),
  HEALTH_SHOW_DETAILS: booleanFromEnv.optional(),
  PERF_LOGGING: booleanFromEnv.optional(),
  ACTIVITY_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).optional(),
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
  OTP_DELIVERY_CHANNEL: otpDeliveryChannelSchema,
  OTP_LENGTH: z.number().int().min(4).max(8),
  OTP_EXPIRY_SECONDS: z.number().int().min(30).max(3600),
  OTP_MAX_ATTEMPTS: z.number().int().min(1).max(10),
  OTP_RESEND_COOLDOWN_SECONDS: z.number().int().min(0).max(3600),
  OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: z.number().int().min(10).max(86400),
  OTP_SEND_RATE_LIMIT_MAX: z.number().int().min(1).max(200),
  OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: z.number().int().min(10).max(86400),
  OTP_VERIFY_RATE_LIMIT_MAX: z.number().int().min(1).max(500),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.boolean(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  SMTP_CONFIGURED: z.boolean(),
  RATE_LIMIT_DRIVER: rateLimitDriverSchema,
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: z.boolean(),
  HEALTH_SHOW_DETAILS: z.boolean(),
  PERF_LOGGING: z.boolean(),
  ACTIVITY_LOG_RETENTION_DAYS: z.number().int().min(1).max(3650),
});

export type Env = z.infer<typeof normalizedEnvSchema>;

let cachedEnv: Env | null = null;

function isBuildPhase() {
  return process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build";
}

function hasAnySmtpConfig(data: z.infer<typeof rawEnvSchema>): boolean {
  return [
    data.SMTP_HOST,
    data.SMTP_PORT,
    data.SMTP_SECURE,
    data.SMTP_USER,
    data.SMTP_PASSWORD,
    data.SMTP_FROM,
    data.EMAIL_HOST,
    data.EMAIL_PORT,
    data.EMAIL_SECURE,
    data.EMAIL_USER,
    data.EMAIL_PASS,
    data.EMAIL_FROM,
  ].some((value) => value !== undefined);
}

export function resetEnvCache() {
  cachedEnv = null;
}

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
  const otpDeliveryChannel = data.OTP_DELIVERY_CHANNEL ?? "email";
  const rateLimitDriver = data.RATE_LIMIT_DRIVER ?? "memory";
  const healthShowDetails = data.HEALTH_SHOW_DETAILS ?? false;
  const allowMemoryRateLimitInProduction = data.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION ?? false;
  const perfLogging = data.PERF_LOGGING ?? false;
  const legacyEmailRequested = Boolean(
    data.EMAIL_USER || data.EMAIL_PASS || data.EMAIL_HOST || data.EMAIL_PORT || data.EMAIL_SECURE !== undefined || data.EMAIL_FROM
  );
  const smtpHost = data.SMTP_HOST ?? data.EMAIL_HOST ?? (legacyEmailRequested ? "smtp.gmail.com" : undefined);
  const smtpPort = data.SMTP_PORT ?? data.EMAIL_PORT ?? (legacyEmailRequested ? 465 : undefined);
  const smtpSecure = data.SMTP_SECURE ?? data.EMAIL_SECURE ?? (legacyEmailRequested ? true : false);
  const smtpUser = data.SMTP_USER ?? data.EMAIL_USER;
  const smtpPassword = data.SMTP_PASSWORD ?? data.EMAIL_PASS;
  const smtpFrom = data.SMTP_FROM ?? data.EMAIL_FROM ?? data.EMAIL_USER;

  if (isProduction && otpDevMode) {
    throw new Error("Invalid environment variables: OTP_DEV_MODE cannot be true in production");
  }

  const smtpConfigured =
    Boolean(smtpHost) &&
    Boolean(smtpPort) &&
    smtpSecure !== undefined &&
    Boolean(smtpUser) &&
    Boolean(smtpPassword) &&
    Boolean(smtpFrom);

  if (otpDeliveryChannel === "email" && hasAnySmtpConfig(data) && !smtpConfigured) {
    throw new Error(
      "Invalid environment variables: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must all be set for email OTP delivery"
    );
  }

  if (rateLimitDriver === "upstash" && (!data.UPSTASH_REDIS_REST_URL || !data.UPSTASH_REDIS_REST_TOKEN)) {
    throw new Error(
      "Invalid environment variables: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required when RATE_LIMIT_DRIVER=upstash"
    );
  }

  if (isProduction && rateLimitDriver === "memory" && !allowMemoryRateLimitInProduction && !isBuildPhase()) {
    throw new Error(
      "Invalid environment variables: RATE_LIMIT_DRIVER=memory is not allowed in production unless ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=true"
    );
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
    OTP_DELIVERY_CHANNEL: otpDeliveryChannel,
    OTP_LENGTH: data.OTP_LENGTH ?? 6,
    OTP_EXPIRY_SECONDS: data.OTP_EXPIRY_SECONDS ?? 300,
    OTP_MAX_ATTEMPTS: data.OTP_MAX_ATTEMPTS ?? 5,
    OTP_RESEND_COOLDOWN_SECONDS: data.OTP_RESEND_COOLDOWN_SECONDS ?? 30,
    OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: data.OTP_SEND_RATE_LIMIT_WINDOW_SECONDS ?? 900,
    OTP_SEND_RATE_LIMIT_MAX: data.OTP_SEND_RATE_LIMIT_MAX ?? 5,
    OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: data.OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS ?? 900,
    OTP_VERIFY_RATE_LIMIT_MAX: data.OTP_VERIFY_RATE_LIMIT_MAX ?? 10,
    SMTP_HOST: smtpHost,
    SMTP_PORT: smtpPort,
    SMTP_SECURE: smtpSecure,
    SMTP_USER: smtpUser,
    SMTP_PASSWORD: smtpPassword,
    SMTP_FROM: smtpFrom,
    SMTP_CONFIGURED: smtpConfigured,
    RATE_LIMIT_DRIVER: rateLimitDriver,
    UPSTASH_REDIS_REST_URL: data.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: data.UPSTASH_REDIS_REST_TOKEN,
    ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: allowMemoryRateLimitInProduction,
    HEALTH_SHOW_DETAILS: healthShowDetails,
    PERF_LOGGING: perfLogging,
    ACTIVITY_LOG_RETENTION_DAYS: data.ACTIVITY_LOG_RETENTION_DAYS ?? 90,
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
