import { env } from "@/lib/config/env";
import { logPerf } from "@/lib/observability/perf";

type CachedEnvelope = {
  storedAt: number;
  expiresAt: number;
  value: string;
};

type LocalCacheEntry = CachedEnvelope;

type PrefixIndex = Map<string, Set<string>>;

export type ServerCacheStatus = {
  state: "hit" | "miss" | "stale";
  source: "local" | "shared" | "none";
};

export type ServerCacheDiagnostics = {
  configuredDriver: "memory" | "upstash";
  effectiveDriver: "memory" | "upstash";
  upstashConfigured: boolean;
  defaultTtlSeconds: number;
};

type GetOrSetOptions = {
  ttlSeconds?: number;
  prefixes?: string[];
};

type SetOptions = {
  ttlSeconds: number;
  prefixes?: string[];
};

const globalCacheState = globalThis as unknown as {
  __matrixServerCacheStore?: Map<string, LocalCacheEntry>;
  __matrixServerCachePrefixIndex?: PrefixIndex;
};

const localStore = globalCacheState.__matrixServerCacheStore ?? new Map<string, LocalCacheEntry>();
const localPrefixIndex = globalCacheState.__matrixServerCachePrefixIndex ?? new Map<string, Set<string>>();

if (!globalCacheState.__matrixServerCacheStore) {
  globalCacheState.__matrixServerCacheStore = localStore;
}

if (!globalCacheState.__matrixServerCachePrefixIndex) {
  globalCacheState.__matrixServerCachePrefixIndex = localPrefixIndex;
}

export function getServerCacheDiagnostics(): ServerCacheDiagnostics {
  const config = env();
  const upstashConfigured = Boolean(config.UPSTASH_REDIS_REST_URL && config.UPSTASH_REDIS_REST_TOKEN);
  const effectiveDriver = config.CACHE_DRIVER === "upstash" && upstashConfigured ? "upstash" : "memory";

  return {
    configuredDriver: config.CACHE_DRIVER,
    effectiveDriver,
    upstashConfigured,
    defaultTtlSeconds: config.CACHE_DEFAULT_TTL_SECONDS,
  };
}

export function getServerCacheDriver() {
  return getServerCacheDiagnostics().effectiveDriver;
}

function getFullCacheKey(namespace: string, key: string) {
  return `matrix:cache:${namespace}:${key}`;
}

function getPrefixIndexKey(prefix: string) {
  return `matrix:cache:index:${prefix}`;
}

function getPrefixTag(namespace: string, prefix: string) {
  return `${namespace}:${prefix}`;
}

function getDefaultTtlSeconds() {
  return getServerCacheDiagnostics().defaultTtlSeconds;
}

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function safeJsonStringify(value: unknown) {
  return JSON.stringify(value);
}

function pruneLocalStore(now = Date.now()) {
  for (const [key, entry] of localStore.entries()) {
    if (entry.expiresAt <= now) {
      localStore.delete(key);
      for (const members of localPrefixIndex.values()) {
        members.delete(key);
      }
    }
  }
}

function rememberLocalPrefixes(fullKey: string, prefixes: string[]) {
  for (const prefix of prefixes) {
    const bucket = localPrefixIndex.get(prefix) ?? new Set<string>();
    bucket.add(fullKey);
    localPrefixIndex.set(prefix, bucket);
  }
}

function writeLocal(fullKey: string, payload: CachedEnvelope, prefixes: string[]) {
  localStore.set(fullKey, payload);
  rememberLocalPrefixes(fullKey, prefixes);
}

function readLocal<T>(fullKey: string, now = Date.now()): T | null {
  const existing = localStore.get(fullKey);
  if (!existing) {
    return null;
  }

  if (existing.expiresAt <= now) {
    localStore.delete(fullKey);
    return null;
  }

  return safeJsonParse<T>(existing.value);
}

async function runUpstashCommand<T>(command: Array<string | number>): Promise<T> {
  const config = env();
  const baseUrl = config.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const token = config.UPSTASH_REDIS_REST_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("upstash_not_configured");
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
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

async function runUpstashPipeline(commands: Array<Array<string | number>>) {
  const config = env();
  const baseUrl = config.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, "");
  const token = config.UPSTASH_REDIS_REST_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("upstash_not_configured");
  }

  const response = await fetch(`${baseUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`upstash_http_${response.status}`);
  }

  return (await response.json()) as Array<{ result?: unknown; error?: string }>;
}

async function readShared<T>(fullKey: string): Promise<T | null> {
  try {
    const payload = await runUpstashCommand<string | null>(["GET", fullKey]);
    return safeJsonParse<T>(payload);
  } catch (error) {
    logPerf("cache.shared_get_error", 0, {
      key: fullKey,
      reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
    return null;
  }
}

async function writeShared(fullKey: string, payload: CachedEnvelope, prefixes: string[]) {
  try {
    const commands: Array<Array<string | number>> = [["SET", fullKey, safeJsonStringify(payload), "EX", Math.max(1, Math.ceil((payload.expiresAt - Date.now()) / 1000))]];

    for (const prefix of prefixes) {
      commands.push(["SADD", getPrefixIndexKey(prefix), fullKey]);
      commands.push(["EXPIRE", getPrefixIndexKey(prefix), Math.max(300, Math.ceil((payload.expiresAt - Date.now()) / 1000))]);
    }

    await runUpstashPipeline(commands);
  } catch (error) {
    logPerf("cache.shared_set_error", 0, {
      key: fullKey,
      reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
  }
}

function normalizePrefixes(namespace: string, prefixes?: string[]) {
  const next = new Set<string>([namespace]);
  for (const prefix of prefixes ?? []) {
    next.add(getPrefixTag(namespace, prefix));
  }
  return Array.from(next);
}

export async function getServerCache<T>(namespace: string, key: string): Promise<T | null> {
  const startedAt = performance.now();
  const diagnostics = getServerCacheDiagnostics();
  let state: ServerCacheStatus["state"] = "miss";
  let source: ServerCacheStatus["source"] = "none";

  pruneLocalStore();

  const fullKey = getFullCacheKey(namespace, key);
  const localValue = readLocal<T>(fullKey);
  if (localValue !== null) {
    state = "hit";
    source = "local";
    logPerf("cache.get", performance.now() - startedAt, {
      namespace,
      driver: diagnostics.effectiveDriver,
      configuredDriver: diagnostics.configuredDriver,
      state,
      source,
    });
    return localValue;
  }

  if (diagnostics.effectiveDriver !== "upstash") {
    logPerf("cache.get", performance.now() - startedAt, {
      namespace,
      driver: diagnostics.effectiveDriver,
      configuredDriver: diagnostics.configuredDriver,
      state,
      source,
    });
    return null;
  }

  source = "shared";
  const sharedPayload = await readShared<CachedEnvelope>(fullKey);
  if (!sharedPayload || sharedPayload.expiresAt <= Date.now()) {
    logPerf("cache.get", performance.now() - startedAt, {
      namespace,
      driver: diagnostics.effectiveDriver,
      configuredDriver: diagnostics.configuredDriver,
      state,
      source,
    });
    return null;
  }

  state = "hit";
  writeLocal(fullKey, sharedPayload, [namespace]);
  logPerf("cache.get", performance.now() - startedAt, {
    namespace,
    driver: diagnostics.effectiveDriver,
    configuredDriver: diagnostics.configuredDriver,
    state,
    source,
  });
  return safeJsonParse<T>(sharedPayload.value);
}

export async function setServerCache<T>(namespace: string, key: string, value: T, options: SetOptions): Promise<T> {
  const startedAt = performance.now();
  const ttlSeconds = Math.max(1, options.ttlSeconds);
  const fullKey = getFullCacheKey(namespace, key);
  const payload: CachedEnvelope = {
    storedAt: Date.now(),
    expiresAt: Date.now() + ttlSeconds * 1000,
    value: safeJsonStringify(value),
  };
  const prefixes = normalizePrefixes(namespace, options.prefixes);
  const diagnostics = getServerCacheDiagnostics();

  writeLocal(fullKey, payload, prefixes);

  if (diagnostics.effectiveDriver === "upstash") {
    await writeShared(fullKey, payload, prefixes);
  }

  logPerf("cache.set", performance.now() - startedAt, {
    namespace,
    driver: diagnostics.effectiveDriver,
    configuredDriver: diagnostics.configuredDriver,
    ttlSeconds,
  });
  return value;
}

export async function getOrSetServerCache<T>(
  namespace: string,
  key: string,
  loader: () => Promise<T>,
  options: GetOrSetOptions = {}
): Promise<T> {
  const ttlSeconds = Math.max(1, options.ttlSeconds ?? getDefaultTtlSeconds());
  const cached = await getServerCache<T>(namespace, key);
  if (cached !== null) {
    return cached;
  }

  const loaded = await loader();
  await setServerCache(namespace, key, loaded, {
    ttlSeconds,
    prefixes: options.prefixes,
  });
  return loaded;
}

export async function deleteServerCache(namespace: string, key: string) {
  const fullKey = getFullCacheKey(namespace, key);
  localStore.delete(fullKey);

  if (getServerCacheDriver() !== "upstash") {
    return;
  }

  try {
    await runUpstashCommand(["DEL", fullKey]);
  } catch (error) {
    logPerf("cache.shared_del_error", 0, {
      key: fullKey,
      reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
  }
}

export async function deleteServerCacheByPrefix(prefix: string) {
  const localKeys = localPrefixIndex.get(prefix);
  if (localKeys) {
    for (const key of localKeys) {
      localStore.delete(key);
    }
    localPrefixIndex.delete(prefix);
  }

  if (getServerCacheDriver() !== "upstash") {
    return;
  }

  try {
    const indexKey = getPrefixIndexKey(prefix);
    const members = await runUpstashCommand<string[]>(["SMEMBERS", indexKey]);
    if (members.length > 0) {
      await runUpstashPipeline([
        ...members.map((member) => ["DEL", member] as Array<string | number>),
        ["DEL", indexKey],
      ]);
    } else {
      await runUpstashCommand(["DEL", indexKey]);
    }
  } catch (error) {
    logPerf("cache.shared_prefix_del_error", 0, {
      prefix,
      reason: error instanceof Error ? error.message.slice(0, 80) : "unknown",
    });
  }
}

export function getServerCacheStatus(namespace: string, key: string): ServerCacheStatus {
  pruneLocalStore();

  const fullKey = getFullCacheKey(namespace, key);
  const localValue = readLocal<unknown>(fullKey);
  if (localValue !== null) {
    return { state: "hit", source: "local" };
  }

  return { state: "miss", source: getServerCacheDriver() === "upstash" ? "shared" : "none" };
}

export function resetServerCacheState() {
  localStore.clear();
  localPrefixIndex.clear();
}
