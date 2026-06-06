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
import { scopeByTenant } from "@/lib/auth/tenant";
import { prisma } from "@/lib/db/prisma";

type TimingResult = {
  name: string;
  ms: number;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

type ThresholdConfig = {
  targetMs: number;
  failMs: number;
};

const THRESHOLDS: Record<string, ThresholdConfig> = {
  "permissions.resolve": { targetMs: 300, failMs: 1_200 },
  "navigation.load": { targetMs: 300, failMs: 1_200 },
  "dashboard.bundle": { targetMs: 1_000, failMs: 4_000 },
  "locations.states_cities": { targetMs: 200, failMs: 800 },
  "users.list": { targetMs: 500, failMs: 2_000 },
  "clients.list": { targetMs: 500, failMs: 2_000 },
  "service_requests.list": { targetMs: 500, failMs: 2_000 },
  "tasks.list": { targetMs: 500, failMs: 2_000 },
  "invoices.list": { targetMs: 500, failMs: 2_000 },
  "finance_reports.summary": { targetMs: 1_000, failMs: 4_000 },
  "service_partners.list": { targetMs: 500, failMs: 2_000 },
};

function redactMessage(message: string) {
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted_url]")
    .replace(/(password|pass|token|secret)=\S+/gi, "$1=[redacted]");
}

function evaluateTiming(name: string, ms: number): TimingResult["status"] {
  const threshold = THRESHOLDS[name];
  if (!threshold) {
    return "pass";
  }
  if (ms > threshold.failMs) {
    return "fail";
  }
  if (ms > threshold.targetMs) {
    return "warn";
  }
  return "pass";
}

async function measure(name: string, work: () => Promise<unknown>, detail?: string): Promise<TimingResult> {
  const startedAt = performance.now();
  await work();
  const ms = Math.round((performance.now() - startedAt) * 100) / 100;
  return {
    name,
    ms,
    status: evaluateTiming(name, ms),
    detail,
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
  const results: TimingResult[] = [];

  results.push(await measure("permissions.resolve", () => getUserPermissions(session.user.id, session.user.roleKeys)));
  results.push(await measure("navigation.load", () => getNavigationForSession(session)));
  results.push(await measure("dashboard.bundle", () => measureDashboardBundle(session)));
  results.push(await measure("locations.states_cities", () => listActiveStatesWithCities()));
  results.push(await measure("users.list", () => listUsers(session, { page: 1, pageSize: 10 })));
  results.push(await measure("clients.list", () => listClients(session, { page: 1, pageSize: 10 })));
  results.push(await measure("service_requests.list", () => listServiceRequests(session, { page: 1, pageSize: 10 })));
  results.push(await measure("tasks.list", () => listTasks(session, { take: 25 })));
  results.push(await measure("invoices.list", () => listInvoices(session, { page: 1, pageSize: 10 })));
  results.push(
    await measure("finance_reports.summary", () =>
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
    results.push(await measure("service_partners.list", () => listServicePartners(session, { page: 1, pageSize: 10 })));
  }

  const otpConfig = getOtpProviderConfigurationStatus();
  results.push({
    name: "otp.provider.config_check",
    ms: 0,
    status:
      otpConfig.otpMode === "dev" || otpConfig.deliveryChannel !== "email" || (otpConfig.smtpConfigured && otpConfig.smtpFromConfigured)
        ? "pass"
        : "warn",
    detail: `mode=${otpConfig.otpMode}, channel=${otpConfig.deliveryChannel}, smtpConfigured=${otpConfig.smtpConfigured}, fromConfigured=${otpConfig.smtpFromConfigured}`,
  });

  console.log("Performance QA Results");
  for (const result of results) {
    const threshold = THRESHOLDS[result.name];
    const targetLabel = threshold ? ` target<=${threshold.targetMs}ms fail>${threshold.failMs}ms` : "";
    const detailLabel = result.detail ? ` ${result.detail}` : "";
    console.log(`[${result.status.toUpperCase()}] ${result.name}: ${result.ms}ms${targetLabel}${detailLabel}`);
  }

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
