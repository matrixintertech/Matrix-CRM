import { NextResponse } from "next/server";

import { getNavigationForSession } from "@/features/navigation/services/navigation.service";
import { listActiveStatesWithCities } from "@/features/locations/services/location.service";
import { getCurrentSession } from "@/lib/auth/session";
import { clearRuntimeCache } from "@/lib/cache/runtime-cache";
import { getServerCacheDiagnostics, resetServerCacheState } from "@/lib/cache/server-cache";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { measureServerTiming, withServerTimingHeaders, type ServerTimingMetric } from "@/lib/observability/server-timing";

function resetNavigationCaches() {
  clearRuntimeCache("navigation.platform_partner");
  clearRuntimeCache("navigation.rows");
  clearRuntimeCache("navigation.tree");
  clearRuntimeCache("auth.permissions.user");
  clearRuntimeCache("auth.permissions.all");
  resetServerCacheState();
}

function resetLocationCaches() {
  clearRuntimeCache("locations.active_states");
  resetServerCacheState();
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session?.user?.id || !session.user.servicePartnerId) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const config = env();
  if (!config.PERFORMANCE_DIAGNOSTICS_ENABLED && !session.user.isSuperAdmin) {
    return NextResponse.json({ ok: false, error: { message: "Not found." } }, { status: 404 });
  }

  const metrics: ServerTimingMetric[] = [];
  const dbPing = await measureServerTiming("db", async () => prisma.$queryRaw`SELECT 1`, "database ping");
  metrics.push(dbPing.metric);

  resetNavigationCaches();
  const navigationCold = await measureServerTiming("navigation-cold", () => getNavigationForSession(session), "navigation cold");
  metrics.push(navigationCold.metric);
  const navigationWarm = await measureServerTiming("navigation-warm", () => getNavigationForSession(session), "navigation warm");
  metrics.push(navigationWarm.metric);

  resetLocationCaches();
  const locationsCold = await measureServerTiming("locations-cold", () => listActiveStatesWithCities(), "locations cold");
  metrics.push(locationsCold.metric);
  const locationsWarm = await measureServerTiming("locations-warm", () => listActiveStatesWithCities(), "locations warm");
  metrics.push(locationsWarm.metric);

  const cache = getServerCacheDiagnostics();

  return NextResponse.json(
    {
      ok: true,
      diagnostics: {
        cache: {
          configuredDriver: cache.configuredDriver,
          effectiveDriver: cache.effectiveDriver,
          upstashConfigured: cache.upstashConfigured,
          defaultTtlSeconds: cache.defaultTtlSeconds,
        },
        flags: {
          performanceDiagnosticsEnabled: config.PERFORMANCE_DIAGNOSTICS_ENABLED,
          perfLogging: config.PERF_LOGGING,
          cacheDebug: config.CACHE_DEBUG,
        },
        timings: {
          dbPingMs: dbPing.metric.durationMs,
          navigation: {
            coldMs: navigationCold.metric.durationMs,
            warmMs: navigationWarm.metric.durationMs,
            itemCount: navigationWarm.result.length,
          },
          locations: {
            coldMs: locationsCold.metric.durationMs,
            warmMs: locationsWarm.metric.durationMs,
            stateCount: locationsWarm.result.length,
          },
        },
      },
    },
    {
      headers: withServerTimingHeaders({ "Cache-Control": "no-store" }, metrics),
    }
  );
}
