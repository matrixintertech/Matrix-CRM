import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

if (process.platform === "win32" && !process.env.PRISMA_CLIENT_ENGINE_TYPE) {
  process.env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
}

function resolveRuntimeDatabaseUrl() {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    return undefined;
  }

  if (process.platform !== "win32") {
    return rawUrl;
  }

  // Some Windows environments fail Neon TLS handshakes when channel binding is enabled.
  // Keep production behavior unchanged on non-Windows runtimes.
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("channel_binding", "disable");
    return url.toString();
  } catch {
    if (/channel_binding=/i.test(rawUrl)) {
      return rawUrl.replace(/channel_binding=[^&]*/gi, "channel_binding=disable");
    }
    const separator = rawUrl.includes("?") ? "&" : "?";
    return `${rawUrl}${separator}channel_binding=disable`;
  }
}

const runtimeDatabaseUrl = resolveRuntimeDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(runtimeDatabaseUrl
      ? {
          datasources: {
            db: {
              url: runtimeDatabaseUrl,
            },
          },
        }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
