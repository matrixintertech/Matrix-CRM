import { env } from "@/lib/config/env";

type PerfMeta = Record<string, string | number | boolean | null | undefined>;

export function isPerfLoggingEnabled() {
  try {
    return env().PERF_LOGGING;
  } catch {
    const flag = process.env.PERF_LOGGING?.trim().toLowerCase();
    return flag === "true" || flag === "1" || flag === "yes" || flag === "on";
  }
}

function sanitizeMeta(meta?: PerfMeta) {
  if (!meta) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined));
}

export function logPerf(name: string, durationMs: number, meta?: PerfMeta) {
  if (!isPerfLoggingEnabled()) {
    return;
  }

  console.info("[perf]", {
    name,
    durationMs: Math.round(durationMs * 100) / 100,
    ...(sanitizeMeta(meta) ? { meta: sanitizeMeta(meta) } : {}),
  });
}

export async function measurePerf<T>(name: string, work: () => Promise<T>, meta?: PerfMeta): Promise<T> {
  const startedAt = performance.now();

  try {
    const result = await work();
    logPerf(name, performance.now() - startedAt, meta);
    return result;
  } catch (error) {
    logPerf(name, performance.now() - startedAt, {
      ...meta,
      ok: false,
    });
    throw error;
  }
}
