type CacheEntry<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

export type RuntimeCacheStatus = {
  state: "hit" | "miss" | "pending" | "stale";
  expiresAt: number | null;
};

const globalCache = globalThis as unknown as {
  __matrixRuntimeCache?: Map<string, CacheEntry<unknown>>;
};

const store = globalCache.__matrixRuntimeCache ?? new Map<string, CacheEntry<unknown>>();

if (!globalCache.__matrixRuntimeCache) {
  globalCache.__matrixRuntimeCache = store;
}

function getCacheKey(namespace: string, key: string) {
  return `${namespace}:${key}`;
}

export function getRuntimeCacheStatus(namespace: string, key: string): RuntimeCacheStatus {
  const cacheKey = getCacheKey(namespace, key);
  const existing = store.get(cacheKey);
  const now = Date.now();

  if (!existing) {
    return {
      state: "miss",
      expiresAt: null,
    };
  }

  if (existing.promise) {
    return {
      state: "pending",
      expiresAt: existing.expiresAt,
    };
  }

  if (existing.value !== undefined && existing.expiresAt > now) {
    return {
      state: "hit",
      expiresAt: existing.expiresAt,
    };
  }

  return {
    state: "stale",
    expiresAt: existing.expiresAt,
  };
}

export function clearRuntimeCache(namespace?: string) {
  if (!namespace) {
    store.clear();
    return;
  }

  for (const key of store.keys()) {
    if (key.startsWith(`${namespace}:`)) {
      store.delete(key);
    }
  }
}

export async function getOrLoadRuntimeCache<T>(
  namespace: string,
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  if (ttlMs <= 0) {
    return loader();
  }

  const cacheKey = getCacheKey(namespace, key);
  const now = Date.now();
  const existing = store.get(cacheKey) as CacheEntry<T> | undefined;

  if (existing && existing.value !== undefined && existing.expiresAt > now) {
    return existing.value;
  }

  if (existing?.promise) {
    return existing.promise;
  }

  const promise = loader()
    .then((value) => {
      store.set(cacheKey, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    })
    .catch((error) => {
      const current = store.get(cacheKey);
      if (current?.promise) {
        store.delete(cacheKey);
      }
      throw error;
    });

  store.set(cacheKey, {
    expiresAt: now + ttlMs,
    promise,
  });

  return promise;
}
