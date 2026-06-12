import { RoleScope } from "@prisma/client";
import Link from "next/link";
import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import {
  getRoleById,
  getRoleManagementOverview,
  listRoles,
  listRoleServicePartnersForForm,
} from "@/features/rbac/services/role.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatEnumLabel, formatOptional } from "@/lib/utils/format";

type RolesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type RolesResult = Awaited<ReturnType<typeof listRoles>>;
type RoleRow = RolesResult["roles"][number];
type RoleDetail = NonNullable<Awaited<ReturnType<typeof getRoleById>>>;

const scopeOptions = Object.values(RoleScope).map((scope) => ({ label: formatEnumLabel(scope), value: scope }));
const roleTypeOptions = [
  { label: "All statuses", value: "" },
  { label: "System roles", value: "system" },
  { label: "Custom roles", value: "custom" },
] as const;
const sortOptions = [
  { label: "Level high to low", value: "level_desc" },
  { label: "Role name (A-Z)", value: "name_asc" },
  { label: "Most users assigned", value: "users_desc" },
  { label: "Recently updated", value: "updated_desc" },
] as const;
const pageSizeOptions = [10, 20, 50];
const matrixColumns = ["read", "create", "update", "delete", "approve", "export"] as const;
const matrixGroups = [
  { key: "users", label: "Users", modules: ["users", "roles", "permissions"] },
  { key: "service_requests", label: "Service Requests", modules: ["service_requests"] },
  { key: "tasks", label: "Tasks", modules: ["tasks"] },
  { key: "procurement", label: "Procurement", modules: ["vendors", "rfq", "vendor_quotations", "purchase_orders"] },
  { key: "finance", label: "Finance", modules: ["invoices", "payments", "vendor_payments", "ledger"] },
  { key: "reports", label: "Reports", modules: ["reports", "activity_logs"] },
  { key: "settings", label: "Settings", modules: ["settings", "email_change_requests"] },
] as const;

function getErrorMessage(code?: string) {
  if (code === "protected") {
    return "That role is protected and cannot be deleted.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Role deleted successfully.";
  }
  return undefined;
}

function buildRolesHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/roles?${query}` : "/roles";
}

function getPageTokens(page: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const tokens: Array<number | string> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) {
    tokens.push("left-gap");
  }

  for (let current = start; current <= end; current += 1) {
    tokens.push(current);
  }

  if (end < totalPages - 1) {
    tokens.push("right-gap");
  }

  tokens.push(totalPages);
  return tokens;
}

function getPercent(value: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function sentenceCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function getRoleTone(role: RoleRow | RoleDetail) {
  if (role.key === "super_admin" || role.scope === "PLATFORM") {
    return "from-[#6b62ff] to-[#4a39e6]";
  }
  if (role.isSystem) {
    return "from-[#3ac86a] to-[#1ba94f]";
  }
  if (role.level >= 4) {
    return "from-[#ffb625] to-[#ff8a00]";
  }
  return "from-[#41bcd8] to-[#1697b8]";
}

function getScopeTone(scope: RoleScope) {
  return scope === "PLATFORM" ? "bg-[#efeaff] text-[#6a42f4]" : "bg-[#e8f0ff] text-[#2d63ff]";
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  trend,
  trendTone,
}: {
  icon: ReactNode;
  title: string;
  value: number;
  subtitle: string;
  trend: string;
  trendTone: string;
}) {
  return (
    <article className="rounded-[24px] border border-[#e8edf7] bg-white/95 p-5 shadow-[0_16px_40px_rgba(23,52,110,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-white/70 bg-gradient-to-br from-[#f8f9ff] to-[#eef3ff] text-[#315cff] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
          {icon}
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${trendTone}`}>{trend}</span>
      </div>
      <p className="mt-4 text-sm font-medium text-[#63759b]">{title}</p>
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function ActionIcon({ kind }: { kind: "select" | "open" | "edit" }) {
  if (kind === "select") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M8 7h8M8 12h8M8 17h5" />
        <rect x="4" y="4" width="16" height="16" rx="3" />
      </svg>
    );
  }

  if (kind === "edit") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M4 20h4l10-10-4-4L4 16v4Z" />
        <path d="m12 6 4 4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
      <path d="M14 4h6v6" />
      <path d="M10 14 20 4" />
      <path d="M20 14v6h-6" />
      <path d="M4 10 14 20" />
    </svg>
  );
}

function PermissionCheck({ checked }: { checked: boolean }) {
  return checked ? (
    <span className="grid h-5 w-5 place-items-center rounded-md bg-[#2f5ef8] text-white shadow-[0_6px_14px_rgba(47,94,248,0.18)]">
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m3.5 8 2.5 2.5L12.5 4" />
      </svg>
    </span>
  ) : (
    <span className="block h-5 w-5 rounded-md border border-[#ccd6ea] bg-white" />
  );
}

function getPermissionMatrix(role: RoleDetail) {
  const permissionSet = new Set(role.permissions.map((entry) => `${entry.permission.module}:${entry.permission.action}`));

  return matrixGroups.map((group) => {
    const actions = Object.fromEntries(
      matrixColumns.map((column) => {
        const checked = group.modules.some((module) => {
          if (column === "update") {
            return Array.from(permissionSet).some((entry) => entry.startsWith(`${module}:`) && entry.includes(":update"));
          }

          return permissionSet.has(`${module}:${column}`);
        });

        return [column, checked];
      })
    ) as Record<(typeof matrixColumns)[number], boolean>;

    return {
      label: group.label,
      actions,
    };
  });
}

export default async function RolesPage({ searchParams }: RolesPageProps) {
  const session = await requirePermission("roles.read");
  const [params, canCreate, canUpdate] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "roles.create"),
    hasPermission(session, "roles.update"),
  ]);

  const q = getStringParam(params, "q");
  const scopeParam = getStringParam(params, "scope");
  const scope = Object.values(RoleScope).find((value) => value === scopeParam);
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const roleType = getStringParam(params, "roleType");
  const selectedId = getStringParam(params, "selected");
  const sortBy = getStringParam(params, "sortBy") ?? "level_desc";
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, servicePartners] = await Promise.all([
    listRoles(session, {
      q,
      scope,
      servicePartnerId,
      roleType: roleType === "system" || roleType === "custom" ? roleType : undefined,
      sortBy: sortBy as "name_asc" | "level_desc" | "users_desc" | "updated_desc",
      page,
      pageSize,
    }),
    getRoleManagementOverview(session, {
      scope,
      servicePartnerId,
      roleType: roleType === "system" || roleType === "custom" ? roleType : undefined,
    }),
    listRoleServicePartnersForForm(session),
  ]);

  const selectedRoleId = selectedId && result.roles.some((role) => role.id === selectedId) ? selectedId : result.roles[0]?.id;
  const selectedRole = selectedRoleId ? await getRoleById(session, selectedRoleId) : null;
  const permissionMatrix = selectedRole ? getPermissionMatrix(selectedRole) : [];
  const currentFilters = {
    q,
    scope,
    servicePartnerId,
    roleType,
    sortBy,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const visiblePages = getPageTokens(result.page, result.totalPages);
  const customPercent = getPercent(overview.customRoles, overview.totalRoles);
  const systemPercent = getPercent(overview.systemRoles, overview.totalRoles);

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-[#e7ecf7] bg-[radial-gradient(circle_at_top_left,_rgba(85,96,255,0.10),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,251,255,0.98))] p-6 shadow-[0_18px_44px_rgba(16,40,88,0.06)] sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#cad6ff] to-transparent" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#7a8cad]">Access Control</p>
            <h1 className="mt-3 text-[2.25rem] font-semibold tracking-[-0.05em] text-[#10244b]">Roles</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
              Manage role templates, hierarchy levels, and permission access across the workspace.
            </p>
          </div>
          {canCreate ? (
            <PrefetchLink
              href="/roles/new"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4v12M4 10h12" />
              </svg>
              <span>Add Role</span>
            </PrefetchLink>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="9" cy="8" r="3" />
                <circle cx="17" cy="10" r="2.5" />
                <path d="M4 18a5 5 0 0 1 10 0" />
                <path d="M14.5 17a4 4 0 0 1 5.5 0" />
              </svg>
            }
            title="Total Roles"
            value={overview.totalRoles}
            subtitle={`Across ${servicePartners.length || 1} workspace${servicePartners.length === 1 ? "" : "s"}`}
            trend={`${systemPercent}% system`}
            trendTone="bg-[#ebf2ff] text-[#315cff]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 3.5 19 6v5.4c0 4.4-2.8 7.7-7 9.1-4.2-1.4-7-4.7-7-9.1V6l7-2.5Z" />
                <path d="m9.5 12.2 1.6 1.7 3.8-4.2" />
              </svg>
            }
            title="System Roles"
            value={overview.systemRoles}
            subtitle="Built-in protected roles"
            trend={`${systemPercent}% share`}
            trendTone="bg-[#ebf6ef] text-[#1b9c56]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="9" cy="8" r="3" />
                <path d="M4 18a5 5 0 0 1 10 0" />
                <path d="M17 7v6M14 10h6" />
              </svg>
            }
            title="Custom Roles"
            value={overview.customRoles}
            subtitle="Created by administrators"
            trend={`${customPercent}% custom`}
            trendTone="bg-[#f3eaff] text-[#8747f4]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="8" cy="8.5" r="2.5" />
                <circle cx="16" cy="8.5" r="2.5" />
                <path d="M3.5 18a4.5 4.5 0 0 1 9 0" />
                <path d="M11.5 18a4.5 4.5 0 0 1 9 0" />
              </svg>
            }
            title="Active Assignments"
            value={overview.activeAssignments}
            subtitle="Users assigned to roles"
            trend={`${overview.totalRoles ? Math.round(overview.activeAssignments / overview.totalRoles) : 0} avg/role`}
            trendTone="bg-[#fff4e5] text-[#e7881d]"
          />
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
        <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_repeat(4,minmax(0,0.9fr))] xl:items-end">
          <input type="hidden" name="pageSize" value={result.pageSize} />

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Search</span>
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
                placeholder="Search roles..."
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Company</span>
            <select
              name="servicePartnerId"
              defaultValue={servicePartnerId ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All companies</option>
              {servicePartners.map((servicePartner) => (
                <option key={servicePartner.id} value={servicePartner.id}>
                  {servicePartner.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Scope</span>
            <select
              name="scope"
              defaultValue={scope ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All scopes</option>
              {scopeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
            <select
              name="roleType"
              defaultValue={roleType ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              {roleTypeOptions.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Sort By</span>
            <div className="flex gap-3">
              <select
                name="sortBy"
                defaultValue={sortBy}
                className="h-12 min-w-0 flex-1 rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex h-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
              >
                Apply
              </button>
            </div>
          </label>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,0.95fr)]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="hidden overflow-x-auto lg:block">
            <table className="min-w-full text-left">
              <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                <tr>
                  <th className="px-6 py-4">Role Name</th>
                  <th className="px-4 py-4">Scope</th>
                  <th className="px-4 py-4">Level</th>
                  <th className="px-4 py-4">Users</th>
                  <th className="px-4 py-4">Permissions</th>
                  <th className="px-4 py-4">Status</th>
                  <th className="px-4 py-4">Updated</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf2fb]">
                {result.roles.map((role) => {
                  const isSelected = selectedRoleId === role.id;

                  return (
                    <tr key={role.id} className={`transition ${isSelected ? "bg-[#f7f9ff]" : "hover:bg-[#fbfcff]"}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getRoleTone(role)} text-sm font-semibold text-white`}>
                            {role.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#122449]">{role.name}</p>
                            <p className="truncate text-xs text-[#8092b2]">{role.key}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getScopeTone(role.scope)}`}>
                          {formatEnumLabel(role.scope)}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm font-semibold text-[#28426e]">{role.level}</td>
                      <td className="px-4 py-4 text-sm text-[#28426e]">{role._count.users}</td>
                      <td className="px-4 py-4 text-sm text-[#28426e]">{role._count.permissions}</td>
                      <td className="px-4 py-4">
                        <span className="inline-flex rounded-full bg-[#eaf8ef] px-3 py-1 text-xs font-semibold text-[#1d9d57]">Active</span>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#28426e]">{formatDateTime(role.updatedAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={buildRolesHref({ ...currentFilters, selected: role.id, page: result.page })}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]"
                            aria-label={`Select ${role.name}`}
                          >
                            <ActionIcon kind="select" />
                          </Link>
                          <PrefetchLink
                            href={`/roles/${role.id}`}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]"
                            aria-label={`Open ${role.name}`}
                          >
                            <ActionIcon kind="open" />
                          </PrefetchLink>
                          {canUpdate ? (
                            <PrefetchLink
                              href={`/roles/${role.id}/edit`}
                              className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]"
                              aria-label={`Edit ${role.name}`}
                            >
                              <ActionIcon kind="edit" />
                            </PrefetchLink>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 p-4 lg:hidden">
            {result.roles.map((role) => {
              const isSelected = selectedRoleId === role.id;
              return (
                <article
                  key={role.id}
                  className={`rounded-[24px] border p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)] ${
                    isSelected ? "border-[#dbe3ff] bg-[#f7f9ff]" : "border-[#e8edf6] bg-[#fbfcff]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getRoleTone(role)} text-sm font-semibold text-white`}>
                        {role.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{role.name}</p>
                        <p className="truncate text-xs text-[#8092b2]">{role.key}</p>
                      </div>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getScopeTone(role.scope)}`}>
                      {formatEnumLabel(role.scope)}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Level</p>
                      <p className="mt-1 text-sm text-[#16315f]">{role.level}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Users</p>
                      <p className="mt-1 text-sm text-[#16315f]">{role._count.users}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Permissions</p>
                      <p className="mt-1 text-sm text-[#16315f]">{role._count.permissions}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Updated</p>
                      <p className="mt-1 text-sm text-[#16315f]">{formatDateTime(role.updatedAt)}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <Link
                      href={buildRolesHref({ ...currentFilters, selected: role.id, page: result.page })}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]"
                    >
                      <ActionIcon kind="select" />
                      <span>Select</span>
                    </Link>
                    <PrefetchLink
                      href={`/roles/${role.id}`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]"
                    >
                      <ActionIcon kind="open" />
                      <span>Open</span>
                    </PrefetchLink>
                  </div>
                </article>
              );
            })}
          </div>

          {result.roles.length === 0 ? (
            <div className="border-t border-[#edf2fb] px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No roles found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi role match nahi hua. Search ya dropdown filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm text-[#7486a8]">
                Showing {showingFrom} to {showingTo} of {result.total} roles
              </p>

              <div className="flex flex-wrap items-center gap-2">
                {result.page > 1 ? (
                  <Link
                    href={buildRolesHref({ ...currentFilters, selected: selectedRoleId, page: result.page - 1 })}
                    className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m15 6-6 6 6 6" />
                    </svg>
                  </Link>
                ) : null}

                {visiblePages.map((token) =>
                  typeof token === "number" ? (
                    <Link
                      key={token}
                      href={buildRolesHref({ ...currentFilters, selected: selectedRoleId, page: token })}
                      className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
                        token === result.page
                          ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]"
                          : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
                      }`}
                    >
                      {token}
                    </Link>
                  ) : (
                    <span key={token} className="px-1 text-sm text-[#8ea0bf]">
                      ...
                    </span>
                  )
                )}

                {result.page < result.totalPages ? (
                  <Link
                    href={buildRolesHref({ ...currentFilters, selected: selectedRoleId, page: result.page + 1 })}
                    className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </Link>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href="/roles"
                  className="rounded-xl border border-[#dfe6f2] px-3 py-2 text-sm font-semibold text-[#6f82a4] transition hover:bg-[#f8faff]"
                >
                  Reset
                </Link>
                {pageSizeOptions.map((size) => (
                  <Link
                    key={size}
                    href={buildRolesHref({ ...currentFilters, selected: selectedRoleId, page: 1, pageSize: size })}
                    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                      size === result.pageSize
                        ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]"
                        : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                    }`}
                  >
                    {size} / page
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-[30px] border border-[#e6ecf7] bg-white p-5 shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          {selectedRole ? (
            <div>
              <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[#122449]">Role Details</h2>

              <div className="mt-5 flex items-start gap-4">
                <div className={`grid h-14 w-14 place-items-center rounded-[18px] bg-gradient-to-br ${getRoleTone(selectedRole)} text-white`}>
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <circle cx="8.5" cy="8.5" r="3" />
                    <circle cx="16.5" cy="8.5" r="2.5" />
                    <path d="M4 18a5 5 0 0 1 9 0" />
                    <path d="M14 18a4 4 0 0 1 6 0" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-semibold text-[#122449]">{selectedRole.name}</h3>
                    <span className="inline-flex rounded-full bg-[#eaf8ef] px-3 py-1 text-xs font-semibold text-[#1d9d57]">Active</span>
                  </div>
                  <p className="mt-2 text-sm text-[#66799d]">
                    Scope: {sentenceCase(selectedRole.scope)} <span className="px-1.5 text-[#b4c0d6]">•</span> Level: {selectedRole.level}{" "}
                    <span className="px-1.5 text-[#b4c0d6]">•</span> Users: {selectedRole.users.length}
                  </p>
                  <p className="mt-1 text-sm text-[#66799d]">
                    Last updated: {formatDateTime(selectedRole.updatedAt)}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-[#122449]">Description</p>
                <p className="mt-2 text-sm leading-6 text-[#66799d]">{formatOptional(selectedRole.description)}</p>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[#122449]">Permission Matrix Preview</p>
                  <span className="text-xs text-[#8ea0bf]">({selectedRole.permissions.length} permissions)</span>
                </div>

                <div className="mt-3 overflow-hidden rounded-[20px] border border-[#e8edf7]">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.16em] text-[#7387ad]">
                      <tr>
                        <th className="px-4 py-3">Module</th>
                        {matrixColumns.map((column) => (
                          <th key={column} className="px-3 py-3 text-center">
                            {sentenceCase(column)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#edf2fb]">
                      {permissionMatrix.map((row) => (
                        <tr key={row.label}>
                          <td className="px-4 py-3 font-medium text-[#173260]">{row.label}</td>
                          {matrixColumns.map((column) => (
                            <td key={column} className="px-3 py-3">
                              <div className="flex justify-center">
                                <PermissionCheck checked={row.actions[column]} />
                              </div>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-6">
                <p className="text-sm font-semibold text-[#122449]">Grant Rules</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex rounded-full bg-[#ecf2ff] px-3 py-2 text-xs font-semibold text-[#315cff]">Role-based access</span>
                  <span className="inline-flex rounded-full bg-[#ebf7ee] px-3 py-2 text-xs font-semibold text-[#24a15d]">
                    {selectedRole.isSystem ? "Inherited visibility" : "Admin managed"}
                  </span>
                  <span className="inline-flex rounded-full bg-[#f5ebff] px-3 py-2 text-xs font-semibold text-[#8a45f4]">
                    {selectedRole.scope === "TENANT" ? "Tenant scoped" : "Platform scoped"}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <path d="M8 7h8M8 12h8M8 17h5" />
                  <rect x="4" y="4" width="16" height="16" rx="3" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No role selected</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#7486a8]">Left table se koi role select karein to yahan uski detail preview dikh jayegi.</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-[28px] border border-[#e6ecf7] bg-white p-5 shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#4e7bff] to-[#2f5ef8] text-white">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 4v5M7 10v4M17 10v4M4 18h16" />
                <rect x="9" y="9" width="6" height="6" rx="1.5" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[#122449]">Role hierarchy</h3>
              <p className="mt-2 text-sm leading-6 text-[#6d80a4]">
                Roles inherit permissions from higher levels. Higher level overrides apply automatically.
              </p>
              <PrefetchLink href="/roles" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#315cff]">
                <span>Learn more</span>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 10h12M10 4l6 6-6 6" />
                </svg>
              </PrefetchLink>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-[#e6ecf7] bg-white p-5 shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#48cf73] to-[#20b45b] text-white">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <rect x="5" y="4" width="14" height="16" rx="2.5" />
                <path d="M8 9h8M8 13h8M8 17h5" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[#122449]">Permission presets</h3>
              <p className="mt-2 text-sm leading-6 text-[#6d80a4]">
                Use preset templates to quickly create roles with recommended permissions.
              </p>
              <PrefetchLink href="/permissions" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#315cff]">
                <span>Explore permissions</span>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 10h12M10 4l6 6-6 6" />
                </svg>
              </PrefetchLink>
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-[#e6ecf7] bg-white p-5 shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="flex items-start gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#ff9828] to-[#ff6f11] text-white">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4l2.5 2.5" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[#122449]">Assignment impact</h3>
              <p className="mt-2 text-sm leading-6 text-[#6d80a4]">
                Changes to roles may affect user access across modules and operational data immediately.
              </p>
              <PrefetchLink href={selectedRole ? `/roles/${selectedRole.id}` : "/roles"} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#315cff]">
                <span>View impact</span>
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 10h12M10 4l6 6-6 6" />
                </svg>
              </PrefetchLink>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
