import type { Session } from "next-auth";

import { buildRoleSignature, cachePrefixes } from "@/lib/cache/cache-keys";
import { getOrLoadRuntimeCache } from "@/lib/cache/runtime-cache";
import { getOrSetServerCache } from "@/lib/cache/server-cache";
import { getUserPermissions } from "@/lib/auth/permissions";
import { env } from "@/lib/config/env";
import { prisma } from "@/lib/db/prisma";
import { measurePerf } from "@/lib/observability/perf";

export type SidebarNavItem = {
  id: string;
  key: string;
  label: string;
  href: string;
  icon: string | null;
  children: SidebarNavItem[];
  isDevelopmentFallback?: boolean;
};

type NavigationRow = {
  id: string;
  key: string;
  label: string;
  href: string;
  icon: string | null;
  parentId: string | null;
  sortOrder: number;
  permissions: {
    permission: {
      key: string;
    };
  }[];
};

const NAVIGATION_ROW_CACHE_TTL_MS = 10 * 60_000;
const PLATFORM_PARTNER_CACHE_TTL_MS = 30 * 60_000;
const NAVIGATION_TREE_CACHE_TTL_MS = 60_000;
const NAVIGATION_ROW_CACHE_TTL_SECONDS = 10 * 60;
const USER_NAVIGATION_CACHE_TTL_SECONDS = 60;

const fallbackHrefByKey: Record<string, string> = {
  dashboard: "/",
  users: "/users",
  roles: "/roles",
  permissions: "/permissions",
  "service-partners": "/service-partners",
  service_partners: "/service-partners",
  clients: "/clients",
  branches: "/branches",
  "service-requests": "/service-requests",
  service_requests: "/service-requests",
  categories: "/categories",
  items: "/items",
  "rate-cards": "/rate-cards",
  rate_cards: "/rate-cards",
  "invoice-list": "/invoices",
  invoices: "/invoices",
  ledger: "/ledger",
  "finance-reports": "/finance-reports",
  finance_reports: "/finance-reports",
  "vendor-payments-list": "/vendor-payments",
  vendor_payments: "/vendor-payments",
  "activity-log": "/activity-log",
  activity_logs: "/activity-log",
  settings: "/settings",
};

function normalizeHref(href: string, key: string) {
  const rawValue = href.trim();
  if (!rawValue) {
    return fallbackHrefByKey[key] ?? "/";
  }
  if (rawValue === "#") {
    return "#";
  }

  const normalized = rawValue.startsWith("/") ? rawValue : `/${rawValue}`;
  if (normalized === "/dashboard") {
    return "/";
  }

  if (normalized.startsWith("/dashboard/")) {
    return normalized.replace(/^\/dashboard/, "");
  }

  return normalized;
}

function canSeeItem(row: NavigationRow, permissionKeys: Set<string>, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) {
    return true;
  }

  if (row.permissions.length === 0) {
    return true;
  }

  return row.permissions.some((entry) => permissionKeys.has(entry.permission.key));
}

function buildTree(rows: NavigationRow[], permissionKeys: Set<string>, isSuperAdmin: boolean): SidebarNavItem[] {
  const sortedRows = [...rows].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
  const rowsByParent = new Map<string | null, NavigationRow[]>();

  for (const row of sortedRows) {
    const siblings = rowsByParent.get(row.parentId) ?? [];
    siblings.push(row);
    rowsByParent.set(row.parentId, siblings);
  }

  function buildChildren(parentId: string | null): SidebarNavItem[] {
    const items: SidebarNavItem[] = [];

    for (const row of rowsByParent.get(parentId) ?? []) {
      const children = buildChildren(row.id);
      const visible = canSeeItem(row, permissionKeys, isSuperAdmin) || children.length > 0;

      if (visible) {
        items.push({
          id: row.id,
          key: row.key,
          label: row.label,
          href: normalizeHref(row.href, row.key),
          icon: row.icon,
          children,
        });
      }
    }

    return items;
  }

  return buildChildren(null);
}

export async function getNavigationForSession(session: Session): Promise<SidebarNavItem[]> {
  return measurePerf(
    "navigation.get_for_session",
    async () => {
      const platformCode = env().PLATFORM_SERVICE_PARTNER_CODE;
      const platformPartnerId = await getOrLoadRuntimeCache(
        "navigation.platform_partner",
        platformCode,
        PLATFORM_PARTNER_CACHE_TTL_MS,
        async () => {
          const platformPartner = await prisma.servicePartner.findUnique({
            where: { code: platformCode },
            select: { id: true },
          });
          return platformPartner?.id ?? null;
        }
      );

      const candidateServicePartnerIds = [session.user.servicePartnerId, platformPartnerId].filter(
        (value): value is string => Boolean(value)
      );
      const permissions = session.user.isSuperAdmin ? [] : await getUserPermissions(session.user.id, session.user.roleKeys);
      const treeCacheKey = [
        session.user.id,
        session.user.servicePartnerId,
        platformPartnerId ?? "none",
        session.user.isSuperAdmin ? "super_admin" : buildRoleSignature(permissions),
      ].join(":");

      const tree = await getOrSetServerCache(
        "navigation.tree",
        treeCacheKey,
        async () => {
          const rowsByServicePartnerId = new Map<string, NavigationRow[]>();
          await Promise.all(
            candidateServicePartnerIds.map(async (servicePartnerId) => {
              const rows = await getOrSetServerCache(
                "navigation.rows",
                servicePartnerId,
                () =>
                  prisma.navigationItem.findMany({
                    where: {
                      servicePartnerId,
                      isActive: true,
                    },
                    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
                    select: {
                      id: true,
                      key: true,
                      label: true,
                      href: true,
                      icon: true,
                      parentId: true,
                      sortOrder: true,
                      permissions: {
                        select: {
                          permission: {
                            select: { key: true },
                          },
                        },
                      },
                    },
                  }),
                {
                  ttlSeconds: NAVIGATION_ROW_CACHE_TTL_SECONDS,
                  prefixes: [cachePrefixes.navigation, `${cachePrefixes.navigation}:rows:${servicePartnerId}`],
                }
              );

              rowsByServicePartnerId.set(servicePartnerId, rows);
            })
          );

          const rows =
            rowsByServicePartnerId.get(session.user.servicePartnerId) ??
            (platformPartnerId ? rowsByServicePartnerId.get(platformPartnerId) : undefined) ??
            [];

          if (rows.length === 0) {
            return [
              {
                id: "dev-fallback-dashboard",
                key: "dashboard",
                label: "Dashboard",
                href: "/",
                icon: null,
                children: [],
                isDevelopmentFallback: true,
              },
            ];
          }

          return buildTree(rows, new Set(permissions), session.user.isSuperAdmin);
        },
        {
          ttlSeconds: USER_NAVIGATION_CACHE_TTL_SECONDS,
          prefixes: [
            cachePrefixes.navigation,
            `${cachePrefixes.navigation}:tenant:${session.user.servicePartnerId}`,
            `${cachePrefixes.navigation}:user:${session.user.id}`,
          ],
        }
      );

      return getOrLoadRuntimeCache("navigation.tree", treeCacheKey, NAVIGATION_TREE_CACHE_TTL_MS, async () => tree);
    },
    { userId: session.user.id, servicePartnerId: session.user.servicePartnerId }
  );
}
