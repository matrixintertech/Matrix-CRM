import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import ws from "ws";

type PrismaClientOptions = ConstructorParameters<typeof PrismaClient>[0];

function shouldUseNeonAdapter(connectionString: string | undefined): connectionString is string {
  return typeof connectionString === "string" && connectionString.includes(".neon.tech") && isNeonAdapterEnabled();
}

function isNeonAdapterEnabled() {
  const flag = process.env.PRISMA_USE_NEON_ADAPTER?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes" || flag === "on";
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
