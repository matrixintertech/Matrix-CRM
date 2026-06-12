import Link from "next/link";
import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import {
  getPermissionOverview,
  listPermissionFilterOptions,
  listPermissionGroups,
  listPermissionMatrix,
  listRecentPermissionChanges,
} from "@/features/rbac/services/permission.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime } from "@/lib/utils/format";
import { comparePermissionActions, getPermissionActionLabel } from "@/lib/rbac/permission-matrix";

type PermissionsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const matrixColumns = ["read", "create", "update", "delete", "approve", "export", "assign", "status.update"] as const;
const preferredModules = [
  "users",
  "clients",
  "service_requests",
  "tasks",
  "quotations",
  "rfq",
  "purchase_orders",
  "invoices",
  "payments",
  "ledger",
  "reports",
  "activity_logs",
  "settings",
] as const;

type MatrixColumn = (typeof matrixColumns)[number];

function formatModuleLabel(module: string) {
  const labels: Record<string, string> = {
    users: "Users",
    clients: "Clients",
    service_requests: "Service Requests",
    tasks: "Tasks",
    quotations: "Quotations",
    rfq: "RFQs",
    purchase_orders: "Purchase Orders",
    invoices: "Vendor Invoices",
    payments: "Payments",
    ledger: "Ledger",
    reports: "Finance Reports",
    activity_logs: "Activity Log",
    settings: "Settings",
    service_partners: "Service Partners",
    branches: "Branches",
    categories: "Categories",
    items: "Items",
    rate_cards: "Rate Cards",
    vendors: "Supplier Management",
    vendor_payments: "Vendor Payments",
    vendor_quotations: "Vendor Quotations",
    email_change_requests: "Email Change Requests",
    permissions: "Permissions",
    roles: "Roles",
    dashboard: "Dashboard",
  };

  return labels[module] ?? module.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function getCellState(actions: string[], column: MatrixColumn) {
  if (column === "assign") {
    return actions.some(
      (action) =>
        action === "assign" ||
        action.startsWith("assign.") ||
        action === "delegate" ||
        action === "roles.assign" ||
        action === "responsibility.read" ||
        action === "responsibility.update"
    );
  }

  if (column === "status.update") {
    return actions.includes("status.update") || actions.includes("status");
  }

  return actions.includes(column);
}

function getTodayLabel(value: Date | null) {
  if (!value) {
    return "No recent changes";
  }

  const now = new Date();
  const sameDay =
    now.getFullYear() === value.getFullYear() && now.getMonth() === value.getMonth() && now.getDate() === value.getDate();

  return sameDay ? "Today" : new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" }).format(value);
}

function formatChangeTime(value: Date) {
  const now = new Date();
  const sameDay =
    now.getFullYear() === value.getFullYear() && now.getMonth() === value.getMonth() && now.getDate() === value.getDate();

  return sameDay
    ? new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(value)
    : new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

function getModuleOrder(module: string) {
  const index = preferredModules.indexOf(module as (typeof preferredModules)[number]);
  return index === -1 ? preferredModules.length : index;
}

function getGroupBadge(permissionCount: number, totalPermissions: number, roleKey: string) {
  if (roleKey === "super_admin" || permissionCount >= Math.round(totalPermissions * 0.7)) {
    return { label: "Full Access", tone: "bg-[#edf2ff] text-[#315cff]" };
  }
  if (permissionCount >= Math.round(totalPermissions * 0.35)) {
    return { label: "Custom", tone: "bg-[#f5ebff] text-[#8a45f4]" };
  }
  return { label: "Restricted", tone: "bg-[#edf8ef] text-[#2ea35d]" };
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  chip,
  chipTone,
}: {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  subtitle: string;
  chip: string;
  chipTone: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#e8edf7] bg-white/95 p-5 shadow-[0_16px_40px_rgba(23,52,110,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/70 bg-gradient-to-br from-[#f8f9ff] to-[#eef3ff] text-[#315cff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {icon}
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${chipTone}`}>{chip}</span>
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#7082a6]">{title}</p>
      <div className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value}</div>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function MatrixAllowed() {
  return (
    <span className="grid h-5 w-5 place-items-center rounded-md bg-[#2f5ef8] text-white shadow-[0_6px_14px_rgba(47,94,248,0.18)]">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m3.5 8 2.5 2.5L12.5 4" />
      </svg>
    </span>
  );
}

function MatrixDenied() {
  return (
    <span className="grid h-5 w-5 place-items-center rounded-md border border-[#d7deed] bg-[#f8faff] text-[#97a6c0]">
      <span className="block h-[2px] w-2 rounded-full bg-current" />
    </span>
  );
}

function MatrixLocked() {
  return (
    <span className="grid h-5 w-5 place-items-center rounded-md border border-[#ffe0bc] bg-[#fff5e8] text-[#f08a21]">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="7" width="9" height="6" rx="1.5" />
        <path d="M5.5 7V5.8a2.5 2.5 0 1 1 5 0V7" />
      </svg>
    </span>
  );
}

function ChangeIcon({ action }: { action: string }) {
  if (action.includes("remove")) {
    return (
      <div className="grid h-10 w-10 place-items-center rounded-full bg-[#fff5e8] text-[#f08a21]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
          <rect x="5" y="11" width="14" height="2" rx="1" />
        </svg>
      </div>
    );
  }

  if (action.includes("create")) {
    return (
      <div className="grid h-10 w-10 place-items-center rounded-full bg-[#eef2ff] text-[#315cff]">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
    );
  }

  return (
    <div className="grid h-10 w-10 place-items-center rounded-full bg-[#ecf8ef] text-[#2ea35d]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="m5 12 4 4L19 6" />
      </svg>
    </div>
  );
}

export default async function PermissionsPage({ searchParams }: PermissionsPageProps) {
  const session = await requirePermission("permissions.read");
  const params = await resolveSearchParams(searchParams);

  const q = getStringParam(params, "q");
  const moduleFilter = getStringParam(params, "module");
  const actionFilter = getStringParam(params, "action");

  const [overview, filterOptions, matrixPermissions, permissionGroups, recentChanges] = await Promise.all([
    getPermissionOverview(session),
    listPermissionFilterOptions(session),
    listPermissionMatrix(session, { q, module: moduleFilter, action: actionFilter }),
    listPermissionGroups(session),
    listRecentPermissionChanges(session),
  ]);

  const matrixRows = Array.from(
    matrixPermissions.reduce<Map<string, { module: string; actions: string[] }>>((map, permission) => {
      const existing = map.get(permission.module);
      if (existing) {
        existing.actions.push(permission.action);
      } else {
        map.set(permission.module, { module: permission.module, actions: [permission.action] });
      }
      return map;
    }, new Map()).values()
  ).sort((left, right) => getModuleOrder(left.module) - getModuleOrder(right.module) || left.module.localeCompare(right.module));

  const visibleActions = actionFilter
    ? matrixColumns.filter((column) => column === actionFilter || (column === "status.update" && actionFilter === "status"))
    : matrixColumns;
  const workspaceLabel = session.user.isSuperAdmin ? "Platform workspace" : "Tenant workspace";
  const recentLabel = getTodayLabel(overview.recentlyUpdatedAt);

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-[#e7ecf7] bg-[radial-gradient(circle_at_top_left,_rgba(85,96,255,0.10),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,251,255,0.98))] p-6 shadow-[0_18px_44px_rgba(16,40,88,0.06)] sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#cad6ff] to-transparent" />
        <div className="flex items-start gap-4">
          <div className="grid h-16 w-16 place-items-center rounded-[22px] border border-white/70 bg-gradient-to-br from-[#f0efff] to-[#eef3ff] text-[#4e57fa] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.7-7 9.1-4.2-1.4-7-4.7-7-9.1V6l7-2.5Z" />
              <path d="m9.5 12.2 1.6 1.7 3.8-4.2" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[2.1rem] font-semibold tracking-[-0.05em] text-[#10244b]">Permissions</h1>
              <span className="inline-flex rounded-full bg-[#eef3ff] px-3 py-1 text-xs font-semibold text-[#5470a7]">{workspaceLabel}</span>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
              Manage role-based access and control what actions users can perform across Matrix CRM.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.7-7 9.1-4.2-1.4-7-4.7-7-9.1V6l7-2.5Z" />
                <path d="m9.5 12.2 1.6 1.7 3.8-4.2" />
              </svg>
            }
            title="Total Permissions"
            value={overview.totalPermissions}
            subtitle="Across all modules"
            chip="Active"
            chipTone="bg-[#ecf8ef] text-[#2ea35d]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <rect x="4" y="4" width="6" height="6" rx="1.5" />
                <rect x="14" y="4" width="6" height="6" rx="1.5" />
                <rect x="4" y="14" width="6" height="6" rx="1.5" />
                <rect x="14" y="14" width="6" height="6" rx="1.5" />
              </svg>
            }
            title="Modules Covered"
            value={overview.modulesCovered}
            subtitle="System modules"
            chip="Active"
            chipTone="bg-[#ecf8ef] text-[#2ea35d]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="9" cy="8" r="3" />
                <path d="M4 18a5 5 0 0 1 10 0" />
                <path d="M17 7v6M14 10h6" />
              </svg>
            }
            title="Roles Using Permissions"
            value={overview.rolesUsingPermissions}
            subtitle="Role templates mapped"
            chip="Active"
            chipTone="bg-[#ecf8ef] text-[#2ea35d]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <rect x="4" y="5" width="16" height="15" rx="2.5" />
                <path d="M8 3v4M16 3v4M4 10h16" />
              </svg>
            }
            title="Recently Updated"
            value={overview.recentlyUpdatedAt ? formatDateTime(overview.recentlyUpdatedAt) : "No changes"}
            subtitle={`By ${overview.recentlyUpdatedBy}`}
            chip={recentLabel}
            chipTone="bg-[#edf2ff] text-[#315cff]"
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] p-4 sm:p-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_0.9fr_0.9fr_auto_auto] xl:items-end">
              <label className="block">
                <span className="relative block">
                  <svg
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q}
                    placeholder="Search modules..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <select
                  name="module"
                  defaultValue={moduleFilter ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Modules</option>
                  {filterOptions.modules.map((module) => (
                    <option key={module} value={module}>
                      {formatModuleLabel(module)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <select
                  name="action"
                  defaultValue={actionFilter ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                >
                  <option value="">All Actions</option>
                  {filterOptions.actions.sort(comparePermissionActions).map((action) => (
                    <option key={action} value={action}>
                      {getPermissionActionLabel(action)}
                    </option>
                  ))}
                </select>
              </label>

              <Link
                href="/permissions"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dde5f3] bg-white px-5 text-sm font-semibold text-[#55709f] transition hover:bg-[#f8faff]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12a8 8 0 1 0 2.34-5.66" />
                  <path d="M4 4v5h5" />
                </svg>
                <span>Reset Filters</span>
              </Link>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
                >
                  Apply
                </button>
                <span className="inline-flex min-h-12 items-center rounded-2xl border border-[#dbe4ff] bg-[#f7f9ff] px-4 text-sm font-semibold text-[#5d72a7]">
                  Permission catalog is platform-seeded in this build.
                </span>
              </div>
            </form>
          </div>

          <div className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[#122449]">Permissions Matrix</h2>
                <p className="mt-1 text-sm text-[#7082a6]">Configure module level permissions by actions.</p>
              </div>
              <div className="flex flex-wrap items-center gap-5 text-sm text-[#66799d]">
                <div className="flex items-center gap-2">
                  <MatrixAllowed />
                  <span>Allowed</span>
                </div>
                <div className="flex items-center gap-2">
                  <MatrixDenied />
                  <span>Not Allowed</span>
                </div>
                <div className="flex items-center gap-2">
                  <MatrixLocked />
                  <span>Locked</span>
                </div>
              </div>
            </div>

            {matrixRows.length === 0 ? (
              <div className="py-16 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[#122449]">No permissions found</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                  Current filters ke hisab se koi permission row match nahi hui. Search ya dropdown filters reset karke dobara check karein.
                </p>
              </div>
            ) : (
              <>
                <div className="mt-5 hidden overflow-x-auto lg:block">
                  <table className="min-w-full overflow-hidden rounded-[22px] border border-[#e8edf7] text-left">
                    <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                      <tr>
                        <th className="px-4 py-4">Modules</th>
                        {visibleActions.map((column) => (
                          <th key={column} className="px-3 py-4 text-center">
                            {getPermissionActionLabel(column)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf2fb]">
                      {matrixRows.map((row) => (
                        <tr key={row.module} className="hover:bg-[#fbfcff]">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#f2f5ff] text-[#315cff]">
                                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="1.9">
                                  <rect x="5" y="5" width="14" height="14" rx="3" />
                                  <path d="M9 9h6M9 15h6" />
                                </svg>
                              </div>
                              <span className="text-sm font-medium text-[#173260]">{formatModuleLabel(row.module)}</span>
                            </div>
                          </td>
                          {visibleActions.map((column) => (
                            <td key={column} className="px-3 py-4">
                              <div className="flex justify-center">{getCellState(row.actions, column) ? <MatrixAllowed /> : <MatrixDenied />}</div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 grid gap-4 lg:hidden">
                  {matrixRows.map((row) => (
                    <article key={row.module} className="rounded-[24px] border border-[#e8edf7] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                      <p className="text-sm font-semibold text-[#173260]">{formatModuleLabel(row.module)}</p>
                      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {visibleActions.map((column) => (
                          <div key={column} className="flex items-center justify-between rounded-xl border border-[#e7edf8] bg-white px-3 py-2">
                            <span className="text-xs font-medium text-[#6f82a4]">{getPermissionActionLabel(column)}</span>
                            {getCellState(row.actions, column) ? <MatrixAllowed /> : <MatrixDenied />}
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <div>
                <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Permission Groups</h2>
                <p className="mt-1 text-sm text-[#7082a6]">Manage roles and their permission scope.</p>
              </div>
              <PrefetchLink
                href="/roles"
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff] transition hover:bg-[#f8fbff]"
              >
                Manage Roles
              </PrefetchLink>
            </div>

            <div className="divide-y divide-[#edf2fb]">
              {permissionGroups.map((permissionGroup) => {
                const group = {
                  ...permissionGroup,
                  _count: {
                    permissions: permissionGroup.permissionCount,
                    users: permissionGroup.userCount,
                  },
                };
                const badge = getGroupBadge(group.permissionCount, overview.totalPermissions, group.key);
                return (
                  <PrefetchLink key={group.id} href={`/roles/${group.id}`} className="flex items-center gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-[#5b63ff] to-[#3b52ec] text-sm font-semibold text-white">
                      {group.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{group.name}</p>
                      <p className="mt-1 text-xs text-[#8092b2]">
                        {group.permissionCount} permissions <span className="px-1 text-[#b8c3d8]">|</span> {group.userCount} users
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${badge.tone}`}>{badge.label}</span>
                  </PrefetchLink>
                );
              })}
            </div>

            <div className="border-t border-[#edf2fb] px-5 py-4">
              <PrefetchLink href="/roles" className="inline-flex items-center gap-2 text-sm font-semibold text-[#315cff]">
                <span>View all roles</span>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 10h12M10 4l6 6-6 6" />
                </svg>
              </PrefetchLink>
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent Permission Changes</h2>
              <PrefetchLink href="/activity-log" className="text-sm font-semibold text-[#315cff]">
                View all
              </PrefetchLink>
            </div>

            <div className="divide-y divide-[#edf2fb]">
              {recentChanges.length === 0 ? (
                <div className="px-5 py-10 text-sm text-[#7082a6]">No recent permission changes available.</div>
              ) : (
                recentChanges.map((change) => (
                  <div key={change.id} className="flex gap-3 px-5 py-4">
                    <ChangeIcon action={change.action} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-6 text-[#15305d]">{change.message ?? change.action}</p>
                      <p className="mt-1 text-xs text-[#8092b2]">
                        by {change.actor?.name ?? change.actor?.email ?? "System"}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[#8fa0bd]">{formatChangeTime(change.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

