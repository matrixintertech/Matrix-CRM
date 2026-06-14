import { env } from "@/lib/config/env";

type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  reason?: "backend_unavailable";
};

const globalBucketStore = globalThis as unknown as {
  __matrixRateLimitBuckets?: Map<string, RateLimitBucket>;
  __matrixRateLimitMemoryWarningShown?: boolean;
};

const UPSTASH_RATE_LIMIT_TIMEOUT_MS = 1_200;

const buckets = globalBucketStore.__matrixRateLimitBuckets ?? new Map<string, RateLimitBucket>();

if (!globalBucketStore.__matrixRateLimitBuckets) {
  globalBucketStore.__matrixRateLimitBuckets = buckets;
}

function getOrCreateBucket(key: string, windowSeconds: number, nowMs: number): RateLimitBucket {
  const existing = buckets.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    const next = { count: 0, resetAtMs: nowMs + windowSeconds * 1000 };
    buckets.set(key, next);
    return next;
  }

  return existing;
}

function sweepOldBuckets(nowMs: number): void {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAtMs <= nowMs) {
      buckets.delete(key);
    }
  }
}

function consumeMemoryRateLimit(key: string, windowSeconds: number, max: number): RateLimitResult {
  const nowMs = Date.now();
  sweepOldBuckets(nowMs);

  const bucket = getOrCreateBucket(key, windowSeconds, nowMs);

  if (bucket.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
    };
  }

  bucket.count += 1;

  return {
    allowed: true,
    remaining: Math.max(0, max - bucket.count),
    retryAfterSeconds: Math.max(0, Math.ceil((bucket.resetAtMs - nowMs) / 1000)),
  };
}

function warnMemoryRateLimitInProductionOnce() {
  if (globalBucketStore.__matrixRateLimitMemoryWarningShown) {
    return;
  }

  globalBucketStore.__matrixRateLimitMemoryWarningShown = true;
  console.warn("Using in-memory OTP rate limiting in production because ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=true.");
}

async function runUpstashCommand<T>(segments: Array<string | number>): Promise<T> {
  const config = env();
  const baseUrl = config.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const token = config.UPSTASH_REDIS_REST_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("upstash_not_configured");
  }

  const url = `${baseUrl}/${segments.map((segment) => encodeURIComponent(String(segment))).join("/")}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTASH_RATE_LIMIT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`upstash_http_${response.status}`);
  }

  const payload = (await response.json()) as {
    error?: string;
    result?: T;
  };

  if (payload.error) {
    throw new Error("upstash_command_failed");
  }

  return payload.result as T;
}

async function consumeUpstashRateLimit(key: string, windowSeconds: number, max: number): Promise<RateLimitResult> {
  const count = Number(await runUpstashCommand<number>(["incr", key]));

  if (count === 1) {
    await runUpstashCommand<number>(["expire", key, windowSeconds]);
  }

  let ttlSeconds = Number(await runUpstashCommand<number>(["ttl", key]));
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 0) {
    await runUpstashCommand<number>(["expire", key, windowSeconds]);
    ttlSeconds = windowSeconds;
  }

  if (count > max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, ttlSeconds),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, max - count),
    retryAfterSeconds: Math.max(0, ttlSeconds),
  };
}

export function resetRateLimitState() {
  buckets.clear();
  globalBucketStore.__matrixRateLimitMemoryWarningShown = false;
}

export async function consumeRateLimit(key: string, windowSeconds: number, max: number): Promise<RateLimitResult> {
  const config = env();

  if (config.RATE_LIMIT_DRIVER === "upstash") {
    try {
      return await consumeUpstashRateLimit(key, windowSeconds, max);
    } catch (error) {
      console.error("Shared OTP rate limiting is unavailable.", {
        reason: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });

      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.min(windowSeconds, 60)),
        reason: "backend_unavailable",
      };
    }
  }

  if (config.IS_PRODUCTION && config.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION) {
    warnMemoryRateLimitInProductionOnce();
  }

  return consumeMemoryRateLimit(key, windowSeconds, max);
}
