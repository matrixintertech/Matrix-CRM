type RateLimitBucket = {
  count: number;
  resetAtMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const globalBucketStore = globalThis as unknown as {
  __matrixRateLimitBuckets?: Map<string, RateLimitBucket>;
};

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

export function consumeRateLimit(key: string, windowSeconds: number, max: number): RateLimitResult {
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
