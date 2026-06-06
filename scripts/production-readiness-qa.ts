import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import packageJson from "../package.json";
import { env, resetEnvCache } from "../lib/config/env";
import { sendOtpMessage } from "../features/auth/services/otp-provider.service";
import { consumeRateLimit, resetRateLimitState } from "../lib/security/rate-limit";
import { prisma } from "../lib/db/prisma";
import { GET as healthGet } from "../app/api/health/route";

type QAStatus = "PASS" | "FAIL";
type QAResult = {
  key: string;
  status: QAStatus;
  details?: string;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "..");
const envExamplePath = path.join(projectRoot, ".env.example");

function pushResult(results: QAResult[], key: string, condition: boolean, details?: string) {
  results.push({
    key,
    status: condition ? "PASS" : "FAIL",
    details,
  });
}

async function withEnv<T>(overrides: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  resetEnvCache();
  resetRateLimitState();

  try {
    return await run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    resetEnvCache();
    resetRateLimitState();
  }
}

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://USER:PASSWORD@HOST-POOLER.neon.tech/DB?sslmode=require",
    DIRECT_URL: "postgresql://USER:PASSWORD@HOST.neon.tech/DB?sslmode=require",
    AUTH_SECRET: "replace-with-strong-random-secret",
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    AUTH_URL: "https://app.example.com",
    OTP_DEV_MODE: "false",
    OTP_DELIVERY_CHANNEL: "email",
    RATE_LIMIT_DRIVER: "memory",
    ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: "true",
    HEALTH_SHOW_DETAILS: "false",
    ...overrides,
  };
}

async function main() {
  const results: QAResult[] = [];

  pushResult(results, "package.build_script_exists", typeof packageJson.scripts?.build === "string");
  pushResult(results, "package.db_migrate_deploy_exists", typeof packageJson.scripts?.["db:migrate:deploy"] === "string");
  pushResult(results, "package.prod_check_exists", typeof packageJson.scripts?.["prod:check"] === "string");
  pushResult(
    results,
    "package.production_readiness_qa_exists",
    typeof packageJson.scripts?.["qa:production-readiness"] === "string"
  );
  pushResult(results, "package.node_engine_exists", typeof packageJson.engines?.node === "string");

  await withEnv(baseEnv({ OTP_DEV_MODE: "true" }), async () => {
    let blocked = false;
    try {
      env();
    } catch (error) {
      blocked = error instanceof Error && error.message.includes("OTP_DEV_MODE cannot be true in production");
    }

    pushResult(results, "env.otp_dev_mode_blocked_in_production", blocked);
  });

  await withEnv(
    baseEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
      SMTP_USER: "smtp-user@example.com",
      SMTP_PASSWORD: undefined,
      SMTP_FROM: undefined,
      EMAIL_USER: undefined,
      EMAIL_PASS: undefined,
      EMAIL_FROM: undefined,
    }),
    async () => {
      let blocked = false;
      try {
        env();
      } catch (error) {
        blocked = error instanceof Error && error.message.includes("SMTP_HOST");
      }

      pushResult(results, "env.smtp_requires_complete_config", blocked);
    }
  );

  await withEnv(baseEnv({ RATE_LIMIT_DRIVER: "upstash" }), async () => {
    let blocked = false;
    try {
      env();
    } catch (error) {
      blocked = error instanceof Error && error.message.includes("UPSTASH_REDIS_REST_URL");
    }

    pushResult(results, "env.upstash_requires_rest_credentials", blocked);
  });

  await withEnv(baseEnv({ ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: "false" }), async () => {
    let blocked = false;
    try {
      env();
    } catch (error) {
      blocked = error instanceof Error && error.message.includes("RATE_LIMIT_DRIVER=memory");
    }

    pushResult(results, "env.memory_rate_limit_blocked_by_default_in_production", blocked);
  });

  await withEnv(baseEnv({ ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: "true" }), async () => {
    const result = await consumeRateLimit("qa:production:memory", 60, 2);
    pushResult(results, "rate_limit.memory_driver_allowed_when_explicit", result.allowed);
  });

  await withEnv(
    baseEnv({
      ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: "true",
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
      SMTP_FROM: undefined,
      EMAIL_USER: undefined,
      EMAIL_PASS: undefined,
      EMAIL_FROM: undefined,
    }),
    async () => {
    const result = await sendOtpMessage({
      channel: "EMAIL",
      target: "user@example.com",
      code: "123456",
      purpose: "LOGIN",
    });

    pushResult(
      results,
      "otp.provider_not_configured_is_safe",
      !result.ok && result.code === "PROVIDER_NOT_CONFIGURED"
    );
    }
  );

  const envExample = fs.readFileSync(envExamplePath, "utf8");
  pushResult(results, ".env.example.smtp_password_placeholder", envExample.includes('SMTP_PASSWORD="replace-with-smtp-password"'));
  pushResult(
    results,
    ".env.example.upstash_token_placeholder",
    envExample.includes('UPSTASH_REDIS_REST_TOKEN="replace-with-upstash-rest-token"')
  );
  pushResult(results, ".env.example.database_placeholder", envExample.includes("postgresql://USER:PASSWORD@HOST"));

  let envTracked = false;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", ".env"], {
      cwd: projectRoot,
      stdio: "pipe",
    });
    envTracked = true;
  } catch {
    envTracked = false;
  }
  pushResult(results, "git.env_not_tracked", !envTracked);

  await withEnv(baseEnv({ HEALTH_SHOW_DETAILS: "true", ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION: "true" }), async () => {
    const prismaAny = prisma as any;
    const originalQueryRaw = prismaAny.$queryRaw.bind(prismaAny);

    prismaAny.$queryRaw = async () => [{ ok: 1 }];

    try {
      const response = await healthGet();
      const payload = (await response.json()) as Record<string, unknown>;
      const serialized = JSON.stringify(payload);

      pushResult(results, "health.production_hides_details", !("details" in payload));
      pushResult(results, "health.no_runtime_env_payload", !serialized.includes("runtimeEnv"));
      pushResult(results, "health.no_raw_database_url", !serialized.includes("postgresql://"));
    } finally {
      prismaAny.$queryRaw = originalQueryRaw;
    }
  });

  const failed = results.filter((result) => result.status === "FAIL");
  for (const result of results) {
    const details = result.details ? ` - ${result.details}` : "";
    console.log(`[${result.status}] ${result.key}${details}`);
  }

  if (failed.length > 0) {
    throw new Error(`Production readiness QA failed (${failed.length} checks).`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
