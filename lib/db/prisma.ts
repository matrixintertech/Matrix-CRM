import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

if (process.platform === "win32" && !process.env.PRISMA_CLIENT_ENGINE_TYPE) {
  process.env.PRISMA_CLIENT_ENGINE_TYPE = "binary";
}

function resolveRuntimeDatabaseUrl() {
  const rawUrl =
    process.platform === "win32" && process.env.DIRECT_URL?.trim()
      ? process.env.DIRECT_URL
      : process.env.DATABASE_URL;
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
    url.searchParams.set("gssencmode", "disable");
    return url.toString();
  } catch {
    if (/channel_binding=/i.test(rawUrl)) {
      const withChannelBinding = rawUrl.replace(/channel_binding=[^&]*/gi, "channel_binding=disable");
      if (/gssencmode=/i.test(withChannelBinding)) {
        return withChannelBinding.replace(/gssencmode=[^&]*/gi, "gssencmode=disable");
      }
      const separator = withChannelBinding.includes("?") ? "&" : "?";
      return `${withChannelBinding}${separator}gssencmode=disable`;
    }
    let normalized = rawUrl;
    const querySeparator = normalized.includes("?") ? "&" : "?";
    normalized = `${normalized}${querySeparator}channel_binding=disable`;
    const gssSeparator = normalized.includes("?") ? "&" : "?";
    return `${normalized}${gssSeparator}gssencmode=disable`;
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
