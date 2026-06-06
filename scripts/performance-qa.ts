import { performance } from "node:perf_hooks";

import type { Session } from "next-auth";

import { getOtpProviderConfigurationStatus } from "@/features/auth/services/otp-provider.service";
import { listClients } from "@/features/clients/services/client.service";
import { getFinanceReportData } from "@/features/finance-reports/services/finance-report.service";
import { listInvoices } from "@/features/invoices/services/invoice.service";
import { listActiveStatesWithCities } from "@/features/locations/services/location.service";
import { getNavigationForSession } from "@/features/navigation/services/navigation.service";
import { listServiceRequests } from "@/features/service-requests/services/service-request.service";
import { listServicePartners } from "@/features/service-partners/services/service-partner.service";
import { listTasks } from "@/features/tasks/services/task.service";
import { listUsers } from "@/features/users/services/user.service";
import { getUserPermissions } from "@/lib/auth/permissions";
import { buildFilterSignature, buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { clearRuntimeCache } from "@/lib/cache/runtime-cache";
import { getOrSetServerCache, getServerCacheDiagnostics, getServerCacheStatus, resetServerCacheState } from "@/lib/cache/server-cache";
import { scopeByTenant } from "@/lib/auth/tenant";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";

type ThresholdConfig = {
  targetMs: number;
  failMs: number;
};

type TimingPairResult = {
  name: string;
  coldishMs: number;
  warmMs: number;
  status: "pass" | "warn" | "fail";
  detail?: string;
  cacheState?: string;
};

type MeasurePairOptions = {
  detail?: string;
  resetCacheNamespaces?: string[];
  getCacheState?: () => string;
};

const THRESHOLDS: Record<string, ThresholdConfig> = {
  "permissions.resolve": { targetMs: 100, failMs: 1_200 },
  "navigation.load": { targetMs: 150, failMs: 1_200 },
  "dashboard.bundle": { targetMs: 500, failMs: 4_000 },
  "locations.states_cities": { targetMs: 100, failMs: 800 },
  "users.list": { targetMs: 500, failMs: 2_000 },
  "clients.list": { targetMs: 500, failMs: 2_000 },
  "service_requests.list": { targetMs: 500, failMs: 2_000 },
  "tasks.list": { targetMs: 800, failMs: 2_000 },
  "invoices.list": { targetMs: 500, failMs: 2_000 },
  "finance_reports.summary": { targetMs: 1_000, failMs: 4_000 },
  "service_partners.list": { targetMs: 500, failMs: 2_000 },
};

function redactMessage(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted_url]")
    .replace(/(password|pass|token|secret)=\S+/gi, "$1=[redacted]");
}

function evaluateTiming(name: string, warmMs: number): TimingPairResult["status"] {
  const threshold = THRESHOLDS[name];
  if (!threshold) {
    return "pass";
  }
  if (warmMs > threshold.failMs) {
    return "fail";
  }
  if (warmMs > threshold.targetMs) {
    return "warn";
  }
  return "pass";
}

async function timeWork(work: () => Promise<unknown>) {
  const startedAt = performance.now();
  await work();
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

async function measurePair(name: string, work: () => Promise<unknown>, options: MeasurePairOptions = {}): Promise<TimingPairResult> {
  resetServerCacheState();
  for (const namespace of options.resetCacheNamespaces ?? []) {
    clearRuntimeCache(namespace);
  }

  const coldishMs = await timeWork(work);
  const warmMs = await timeWork(work);

  return {
    name,
    coldishMs,
    warmMs,
    status: evaluateTiming(name, warmMs),
    detail: options.detail,
    cacheState: options.getCacheState?.(),
  };
}

async function loadQaSession(): Promise<Session> {
  const privilegedUser =
    (await prisma.user.findFirst({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        roles: {
          some: {
            role: {
              key: "super_admin",
              deletedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        servicePartnerId: true,
        name: true,
        email: true,
        phone: true,
        roles: {
          where: {
            role: {
              deletedAt: null,
            },
          },
          select: {
            role: {
              select: {
                key: true,
              },
            },
          },
        },
      },
      orderBy: [{ lastLoginAt: "desc" }, { createdAt: "asc" }],
    })) ??
    (await prisma.user.findFirst({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        roles: {
          some: {
            role: {
              deletedAt: null,
            },
          },
        },
      },
      select: {
        id: true,
        servicePartnerId: true,
        name: true,
        email: true,
        phone: true,
        roles: {
          where: {
            role: {
              deletedAt: null,
            },
          },
          select: {
            role: {
              select: {
                key: true,
              },
            },
          },
        },
      },
      orderBy: [{ lastLoginAt: "desc" }, { createdAt: "asc" }],
    }));

  if (!privilegedUser) {
    throw new Error("No active QA user with at least one role was found.");
  }

  return {
    expires: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    user: {
      id: privilegedUser.id,
      servicePartnerId: privilegedUser.servicePartnerId,
      name: privilegedUser.name,
      email: privilegedUser.email,
      phone: privilegedUser.phone,
      roleKeys: privilegedUser.roles.map((entry) => entry.role.key),
      isSuperAdmin: privilegedUser.roles.some((entry) => entry.role.key === "super_admin"),
    },
  };
}

async function measureDashboardBundle(session: Session) {
  const permissionKeys = session.user.isSuperAdmin ? [] : await getUserPermissions(session.user.id, session.user.roleKeys);
  const can = (permissionKey: string) => session.user.isSuperAdmin || permissionKeys.includes(permissionKey);
  const key = [
    session.user.id,
    session.user.servicePartnerId,
    buildRoleSignature(session.user.roleKeys),
    session.user.isSuperAdmin ? "super_admin" : "tenant_user",
  ].join(":");

  await getOrSetServerCache(
    "dashboard.summary",
    key,
    () =>
      Promise.all([
        can("users.read") ? prisma.user.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
        can("clients.read") ? prisma.client.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
        can("service_requests.read")
          ? prisma.serviceRequest.findMany({
              where: scopeByTenant(session, { deletedAt: null }),
              orderBy: [{ createdAt: "desc" }],
              take: 10,
              select: {
                id: true,
                serviceNumber: true,
                title: true,
                status: true,
                createdAt: true,
              },
            })
          : Promise.resolve([]),
        can("invoices.read") ? prisma.invoice.count({ where: scopeByTenant(session, { deletedAt: null }) }) : Promise.resolve(0),
      ]),
    {
      ttlSeconds: 30,
      prefixes: [cachePrefixes.dashboard, `${cachePrefixes.dashboard}:tenant:${session.user.servicePartnerId}`],
    }
  );
}

async function main() {
  const session = await loadQaSession();
  const results: TimingPairResult[] = [];
  const roleSignature = buildRoleSignature(session.user.roleKeys);
  const runtimeEnv = env();
  const cacheDiagnostics = getServerCacheDiagnostics();

  clearRuntimeCache();
  resetServerCacheState();

  results.push(
    await measurePair("permissions.resolve", () => getUserPermissions(session.user.id, session.user.roleKeys), {
      detail: "cache=user permission keys",
      resetCacheNamespaces: ["auth.permissions.user", "auth.permissions.all", "auth.roleKeys"],
      getCacheState: () => {
        const status = getServerCacheStatus("auth.permissions.user", `${session.user.id}:${roleSignature}`);
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(
    await measurePair("navigation.load", () => getNavigationForSession(session), {
      detail: "cache=user nav tree + tenant nav rows",
      resetCacheNamespaces: ["navigation.tree", "navigation.rows", "navigation.platform_partner", "auth.permissions.user", "auth.permissions.all"],
      getCacheState: () => {
        const status = getServerCacheStatus(
          "navigation.tree",
          `${session.user.id}:${session.user.servicePartnerId}:none:${session.user.isSuperAdmin ? "super_admin" : roleSignature}`
        );
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(
    await measurePair("dashboard.bundle", () => measureDashboardBundle(session), {
      detail: "cache=dashboard summary query bundle",
      resetCacheNamespaces: ["auth.permissions.user", "auth.permissions.all"],
      getCacheState: () => {
        const status = getServerCacheStatus(
          "dashboard.summary",
          `${session.user.id}:${session.user.servicePartnerId}:${roleSignature}:${session.user.isSuperAdmin ? "super_admin" : "tenant_user"}`
        );
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(
    await measurePair("locations.states_cities", () => listActiveStatesWithCities(), {
      detail: "cache=shared locations reference",
      resetCacheNamespaces: ["locations.active_states"],
      getCacheState: () => {
        const status = getServerCacheStatus("locations.active_states", "default");
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(
    await measurePair("users.list", () => listUsers(session, { page: 1, pageSize: 10 }), {
      getCacheState: () => {
        const status = getServerCacheStatus(
          "users.list",
          [
            session.user.id,
            session.user.servicePartnerId,
            roleSignature,
            buildFilterSignature({ q: null, status: null, page: 1, pageSize: 10 }),
          ].join(":")
        );
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(await measurePair("clients.list", () => listClients(session, { page: 1, pageSize: 10 })));
  results.push(
    await measurePair("service_requests.list", () => listServiceRequests(session, { page: 1, pageSize: 10 }), {
      getCacheState: () => {
        const status = getServerCacheStatus(
          "service_requests.list",
          [
            session.user.id,
            session.user.servicePartnerId,
            roleSignature,
            buildFilterSignature({ q: null, status: null, clientId: null, branchId: null, page: 1, pageSize: 10 }),
          ].join(":")
        );
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(
    await measurePair("tasks.list", () => listTasks(session, { take: 25 }), {
      detail: "cache=task access context + result page",
      resetCacheNamespaces: ["tasks.access_context", "auth.permissions.user", "auth.permissions.all"],
      getCacheState: () => {
        const status = getServerCacheStatus(
          "tasks.list",
          [
            session.user.id,
            session.user.servicePartnerId,
            roleSignature,
            buildFilterSignature({
              q: null,
              status: null,
              assigneeUserId: null,
              assignedByUserId: null,
              serviceRequestId: null,
              scope: "all",
              requestedFrom: null,
              requestedTo: null,
              dueFrom: null,
              dueTo: null,
              overdue: false,
              take: 25,
            }),
          ].join(":")
        );
        return `${status.source}:${status.state}`;
      },
    })
  );
  results.push(await measurePair("invoices.list", () => listInvoices(session, { page: 1, pageSize: 10 })));
  results.push(
    await measurePair("finance_reports.summary", () =>
      getFinanceReportData(session, {
        dateFrom: undefined,
        dateTo: undefined,
        invoiceStatus: undefined,
        paymentStatus: undefined,
        q: undefined,
        sourceType: undefined,
      })
    )
  );

  if (session.user.isSuperAdmin) {
    results.push(await measurePair("service_partners.list", () => listServicePartners(session, { page: 1, pageSize: 10 })));
  }

  const otpConfig = getOtpProviderConfigurationStatus();
  const cacheFallbackWarning =
    runtimeEnv.IS_PRODUCTION && cacheDiagnostics.effectiveDriver !== "upstash"
      ? "Production is not using Upstash server cache. Expect cold-start and per-instance cache misses."
      : null;

  console.log("Cache Configuration");
  console.log(
    `[${cacheDiagnostics.effectiveDriver === "upstash" ? "PASS" : runtimeEnv.IS_PRODUCTION ? "WARN" : "INFO"}] cache.driver: configured=${cacheDiagnostics.configuredDriver}, effective=${cacheDiagnostics.effectiveDriver}, upstashConfigured=${cacheDiagnostics.upstashConfigured}, defaultTtlSeconds=${cacheDiagnostics.defaultTtlSeconds}`
  );
  console.log(
    `[${runtimeEnv.RATE_LIMIT_DRIVER === "upstash" ? "PASS" : runtimeEnv.IS_PRODUCTION ? "WARN" : "INFO"}] rate_limit.driver: configured=${runtimeEnv.RATE_LIMIT_DRIVER}`
  );
  console.log(
    `[${runtimeEnv.PERF_LOGGING ? "INFO" : "INFO"}] perf.flags: perfLogging=${runtimeEnv.PERF_LOGGING}, cacheDebug=${runtimeEnv.CACHE_DEBUG}`
  );
  if (cacheFallbackWarning) {
    console.log(`[WARN] cache.production_fallback: ${cacheFallbackWarning}`);
  }

  console.log("Performance QA Results");
  console.log("operation | cold-ish ms | warm ms | status | cache");
  for (const result of results) {
    const threshold = THRESHOLDS[result.name];
    const targetLabel = threshold ? ` warm-target<=${threshold.targetMs}ms fail>${threshold.failMs}ms` : "";
    const detailLabel = result.detail ? ` ${result.detail}` : "";
    const cacheLabel = result.cacheState ? ` cache=${result.cacheState}` : "";
    console.log(
      `[${result.status.toUpperCase()}] ${result.name}: cold-ish=${result.coldishMs}ms warm=${result.warmMs}ms${targetLabel}${detailLabel}${cacheLabel}`
    );
  }

  console.log(
    `[${otpConfig.otpMode === "dev" || otpConfig.deliveryChannel !== "email" || (otpConfig.smtpConfigured && otpConfig.smtpFromConfigured) ? "PASS" : "WARN"}] otp.provider.config_check: cold-ish=0ms warm=0ms mode=${otpConfig.otpMode}, channel=${otpConfig.deliveryChannel}, smtpConfigured=${otpConfig.smtpConfigured}, fromConfigured=${otpConfig.smtpFromConfigured}`
  );

  console.log("Manual Production Checklist");
  console.log("- CACHE_DRIVER=upstash");
  console.log("- CACHE_DEFAULT_TTL_SECONDS=60");
  console.log("- CACHE_DEBUG=false");
  console.log("- RATE_LIMIT_DRIVER=upstash");
  console.log("- UPSTASH_REDIS_REST_URL set");
  console.log("- UPSTASH_REDIS_REST_TOKEN set");
  console.log("- Vercel region close to Neon");
  console.log("- Neon region close to primary users");

  const failed = results.filter((result) => result.status === "fail");
  if (failed.length > 0) {
    throw new Error(`Performance QA exceeded extreme thresholds for ${failed.map((result) => result.name).join(", ")}.`);
  }
}

main()
  .catch((error) => {
    const safeMessage = error instanceof Error ? redactMessage(error.message).slice(0, 400) : "unknown error";
    console.error(`Performance QA failed: ${safeMessage}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
