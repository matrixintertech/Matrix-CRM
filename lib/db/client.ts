import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import ws from "ws";

type PrismaClientOptions = ConstructorParameters<typeof PrismaClient>[0];

type NeonAdapterMode = "enabled" | "disabled" | "auto";

function shouldUseNeonAdapter(connectionString: string | undefined): connectionString is string {
  if (typeof connectionString !== "string" || !connectionString.includes(".neon.tech")) {
    return false;
  }

  const mode = getNeonAdapterMode();
  if (mode === "enabled") {
    return true;
  }

  if (mode === "disabled") {
    return false;
  }

  return process.platform === "win32" && process.env.NODE_ENV !== "production";
}

function getNeonAdapterMode(): NeonAdapterMode {
  const flag = process.env.PRISMA_USE_NEON_ADAPTER?.trim().toLowerCase();
  if (!flag || flag === "auto") {
    return "auto";
  }

  if (flag === "true" || flag === "1" || flag === "yes" || flag === "on") {
    return "enabled";
  }

  if (flag === "false" || flag === "0" || flag === "no" || flag === "off") {
    return "disabled";
  }

  return "auto";
}

function getSchemaName(connectionString: string) {
  try {
    return new URL(connectionString).searchParams.get("schema") ?? undefined;
  } catch {
    return undefined;
  }
}

export function createPrismaClient(options?: PrismaClientOptions) {
  const connectionString = process.env.DATABASE_URL;

  if (shouldUseNeonAdapter(connectionString)) {
    neonConfig.webSocketConstructor = ws;
    const schema = getSchemaName(connectionString);
    const adapter = new PrismaNeon(
      { connectionString },
      schema
        ? {
            schema,
          }
        : undefined
    );
    return new PrismaClient({
      ...options,
      adapter,
    });
  }

  return new PrismaClient(options);
}
