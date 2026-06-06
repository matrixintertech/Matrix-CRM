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
import { clearRuntimeCache } from "@/lib/cache/runtime-cache";
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

type ThresholdConfig = {
  targetMs: number;
  failMs: number;
};

type TimingPairResult = {
  name: string;
  coldMs: number;
  warmMs: number;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

type MeasurePairOptions = {
  detail?: string;
  resetCacheNamespaces?: string[];
};

const THRESHOLDS: Record<string, ThresholdConfig> = {
  "permissions.resolve": { targetMs: 300, failMs: 1_200 },
  "navigation.load": { targetMs: 300, failMs: 1_200 },
  "dashboard.bundle": { targetMs: 1_000, failMs: 4_000 },
  "locations.states_cities": { targetMs: 200, failMs: 800 },
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
  for (const namespace of options.resetCacheNamespaces ?? []) {
    clearRuntimeCache(namespace);
  }

  const coldMs = await timeWork(work);
  const warmMs = await timeWork(work);

  return {
    name,
    coldMs,
    warmMs,
    status: evaluateTiming(name, warmMs),
    detail: options.detail,
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

  await Promise.all([
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
  ]);
}

async function main() {
  const session = await loadQaSession();
  const results: TimingPairResult[] = [];

  clearRuntimeCache();

  results.push(
    await measurePair("permissions.resolve", () => getUserPermissions(session.user.id, session.user.roleKeys), {
      detail: "cache=auth.permissions.user",
      resetCacheNamespaces: ["auth.permissions.user", "auth.permissions.all", "auth.roleKeys"],
    })
  );
  results.push(
    await measurePair("navigation.load", () => getNavigationForSession(session), {
      detail: "cache=navigation.tree+navigation.rows",
      resetCacheNamespaces: ["navigation.tree", "navigation.rows", "navigation.platform_partner", "auth.permissions.user", "auth.permissions.all"],
    })
  );
  results.push(
    await measurePair("dashboard.bundle", () => measureDashboardBundle(session), {
      detail: "cache=auth.permissions.user",
      resetCacheNamespaces: ["auth.permissions.user", "auth.permissions.all"],
    })
  );
  results.push(
    await measurePair("locations.states_cities", () => listActiveStatesWithCities(), {
      detail: "cache=locations.active_states",
      resetCacheNamespaces: ["locations.active_states"],
    })
  );
  results.push(await measurePair("users.list", () => listUsers(session, { page: 1, pageSize: 10 })));
  results.push(await measurePair("clients.list", () => listClients(session, { page: 1, pageSize: 10 })));
  results.push(await measurePair("service_requests.list", () => listServiceRequests(session, { page: 1, pageSize: 10 })));
  results.push(
    await measurePair("tasks.list", () => listTasks(session, { take: 25 }), {
      detail: "cache=tasks.access_context",
      resetCacheNamespaces: ["tasks.access_context", "auth.permissions.user", "auth.permissions.all"],
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
  console.log("Performance QA Results");
  for (const result of results) {
    const threshold = THRESHOLDS[result.name];
    const targetLabel = threshold ? ` warm-target<=${threshold.targetMs}ms fail>${threshold.failMs}ms` : "";
    const detailLabel = result.detail ? ` ${result.detail}` : "";
    console.log(
      `[${result.status.toUpperCase()}] ${result.name}: cold=${result.coldMs}ms warm=${result.warmMs}ms${targetLabel}${detailLabel}`
    );
  }

  console.log(
    `[${otpConfig.otpMode === "dev" || otpConfig.deliveryChannel !== "email" || (otpConfig.smtpConfigured && otpConfig.smtpFromConfigured) ? "PASS" : "WARN"}] otp.provider.config_check: cold=0ms warm=0ms mode=${otpConfig.otpMode}, channel=${otpConfig.deliveryChannel}, smtpConfigured=${otpConfig.smtpConfigured}, fromConfigured=${otpConfig.smtpFromConfigured}`
  );

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
