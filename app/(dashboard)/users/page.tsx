import Link from "next/link";
import { UserStatus } from "@prisma/client";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatEnumLabel, formatOptional } from "@/lib/utils/format";
import {
  getUserManagementOverview,
  listAssignableRoles,
  listServicePartnersForUserForm,
  listUsers,
  normalizeUserManagementDateRange,
} from "@/features/users/services/user.service";

type UsersPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type UsersResult = Awaited<ReturnType<typeof listUsers>>;
type UserRow = UsersResult["users"][number];

const statusOptions = Object.values(UserStatus).map((status) => ({ label: formatEnumLabel(status), value: status }));
const dateRangeOptions = [
  { label: "All time", value: "all" },
  { label: "Last 30 days", value: "30d" },
  { label: "Last 90 days", value: "90d" },
  { label: "This year", value: "year" },
] as const;
const pageSizeOptions = [10, 20, 50];

function getErrorMessage(code?: string) {
  if (code === "forbidden") {
    return "You do not have access to this user.";
  }
  if (code === "validation") {
    return "Please review the submitted data.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "User deleted successfully.";
  }
  return undefined;
}

function buildUsersHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === "all") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/users?${query}` : "/users";
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

function getInitials(user: UserRow) {
  const source = user.name?.trim() || user.email?.trim() || user.phone?.trim() || "User";
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getUserHandle(user: UserRow) {
  if (user.email?.trim()) {
    return `@${user.email.split("@")[0]}`;
  }

  if (user.phone?.trim()) {
    return user.phone;
  }

  return "No contact";
}

function getAvatarTone(value: string) {
  const tones = [
    "from-[#5b5df8] to-[#4137d8]",
    "from-[#1f9bf0] to-[#1a77f2]",
    "from-[#11b981] to-[#149c67]",
    "from-[#f97316] to-[#ea580c]",
    "from-[#8b5cf6] to-[#6d28d9]",
  ];
  const total = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function getRoleBadgeTone(roleKey?: string) {
  if (roleKey?.includes("super_admin") || roleKey?.includes("admin")) {
    return "bg-[#ede9ff] text-[#6a42f4]";
  }
  if (roleKey?.includes("manager")) {
    return "bg-[#e6f0ff] text-[#1d5cff]";
  }
  if (roleKey?.includes("operator") || roleKey?.includes("technician")) {
    return "bg-[#dff7ff] text-[#0b92b2]";
  }
  return "bg-[#f2f4f8] text-[#6c7a96]";
}

function getStatusTone(status: UserRow["status"]) {
  if (status === "ACTIVE") {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === "SUSPENDED") {
    return "bg-[#fff3df] text-[#eb8a1f]";
  }
  return "bg-[#ffe9ea] text-[#ef4e5e]";
}

function getPercent(value: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function TableActionIcon({ kind }: { kind: "view" | "edit" | "roles" }) {
  if (kind === "view") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="3" />
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
      <path d="M8 7h8M8 12h8M8 17h5" />
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
  trend,
  trendTone,
}: {
  icon: React.ReactNode;
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

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const session = await requirePermission("users.read");
  const [params, canCreate, canUpdate] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "users.create"),
    hasPermission(session, "users.update"),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(UserStatus).find((value) => value === statusParam);
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const roleKey = getStringParam(params, "roleKey");
  const dateRange = normalizeUserManagementDateRange(getStringParam(params, "dateRange"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, servicePartners, assignableRoles] = await Promise.all([
    listUsers(session, { q, status, servicePartnerId, roleKey, dateRange, page, pageSize }),
    getUserManagementOverview(session, { servicePartnerId, roleKey, dateRange }),
    listServicePartnersForUserForm(session),
    listAssignableRoles(session),
  ]);

  const roleOptions = Array.from(
    new Map(assignableRoles.map((role) => [role.key, { key: role.key, name: role.name }])).values()
  ).sort((left, right) => left.name.localeCompare(right.name));

  const activePercent = getPercent(overview.activeUsers, overview.totalUsers);
  const pendingPercent = getPercent(overview.pendingInvites, overview.totalUsers);
  const inactivePercent = getPercent(overview.inactiveUsers, overview.totalUsers);
  const coveragePercent = getPercent(overview.companiesCovered, Math.max(servicePartners.length, 1));
  const currentFilters = {
    q,
    status,
    servicePartnerId,
    roleKey,
    dateRange,
    pageSize: result.pageSize,
  };
  const exportHref = `/api/users/export?${new URLSearchParams(
    Object.entries(currentFilters).reduce<Record<string, string>>((acc, [key, value]) => {
      if (value && value !== "all") {
        acc[key] = String(value);
      }
      return acc;
    }, {})
  ).toString()}`;
  const visiblePages = getPageTokens(result.page, result.totalPages);
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-[#e7ecf7] bg-[radial-gradient(circle_at_top_left,_rgba(85,96,255,0.10),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,251,255,0.98))] p-6 shadow-[0_18px_44px_rgba(16,40,88,0.06)] sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#cad6ff] to-transparent" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#7a8cad]">User Management</p>
            <h1 className="mt-3 text-[2.25rem] font-semibold tracking-[-0.05em] text-[#10244b]">Client User Management</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
              Manage client users, roles, access, and account status across companies from one dashboard.
            </p>
          </div>
          <div className="rounded-2xl border border-[#e6ebf6] bg-white/80 px-4 py-3 text-sm text-[#7082a6] shadow-[0_10px_24px_rgba(24,48,96,0.04)]">
            <div className="flex items-center gap-2 text-[#4c6494]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              <span>Last updated: just now</span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="8" cy="9" r="3" />
                <circle cx="16" cy="8" r="2.5" />
                <path d="M3.5 18a5.5 5.5 0 0 1 9 0" />
                <path d="M13.8 17.5a4.4 4.4 0 0 1 6 0" />
              </svg>
            }
            title="Total Client Users"
            value={overview.totalUsers}
            subtitle="Across all visible companies"
            trend={`${activePercent}% active`}
            trendTone="bg-[#ebf6ef] text-[#1b9c56]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="9" cy="8" r="3" />
                <path d="M4 18a5 5 0 0 1 10 0" />
                <path d="m15.5 12.5 2 2 3.5-4" />
              </svg>
            }
            title="Active Users"
            value={overview.activeUsers}
            subtitle="Currently active accounts"
            trend={`${activePercent}% share`}
            trendTone="bg-[#ebf6ef] text-[#1b9c56]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M4 7h16v10H4z" />
                <path d="m4 8 8 6 8-6" />
              </svg>
            }
            title="Pending Onboarding"
            value={overview.pendingInvites}
            subtitle="Created users yet to log in"
            trend={`${pendingPercent}% pending`}
            trendTone="bg-[#fff4e5] text-[#e7881d]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="12" cy="8" r="3" />
                <path d="M5 19a7 7 0 0 1 14 0" />
                <path d="M16 15.5 19.5 19" />
              </svg>
            }
            title="Inactive Users"
            value={overview.inactiveUsers}
            subtitle="Require review or reactivation"
            trend={`${inactivePercent}% inactive`}
            trendTone="bg-[#ffedf0] text-[#ef4e5e]"
          />
          <StatCard
            icon={
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M4 5h8v14H4z" />
                <path d="M12 9h8v10h-8z" />
                <path d="M7 9h2M7 13h2M15 13h2M15 17h2" />
              </svg>
            }
            title="Companies Covered"
            value={overview.companiesCovered}
            subtitle="With at least one visible user"
            trend={`${coveragePercent}% coverage`}
            trendTone="bg-[#ebf2ff] text-[#305cff]"
          />
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
        <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.8fr))_auto] xl:items-end">
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
                placeholder="Search users by name, email or phone..."
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
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Role</span>
            <select
              name="roleKey"
              defaultValue={roleKey ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All roles</option>
              {roleOptions.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All statuses</option>
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Date Range</span>
            <select
              name="dateRange"
              defaultValue={dateRange}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              {dateRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
            >
              Apply Filters
            </button>
            <Link
              href="/users"
              className="inline-flex h-12 items-center justify-center rounded-2xl border border-[#e2e8f3] bg-[#f8faff] px-5 text-sm font-semibold text-[#6d7f9f] transition hover:bg-white"
            >
              Reset
            </Link>
            <Link
              href={exportHref}
              prefetch={false}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dde5f3] bg-white px-5 text-sm font-semibold text-[#315cff] transition hover:bg-[#f7f9ff]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12" />
                <path d="m7 10 5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
              <span>Export</span>
            </Link>
            {canCreate ? (
              <PrefetchLink
                href="/users/new"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105"
              >
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 4v12M4 10h12" />
                </svg>
                <span>Add Client User</span>
              </PrefetchLink>
            ) : null}
          </div>
        </form>
      </div>

      <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <div className="hidden overflow-x-auto lg:block">
          <table className="min-w-full text-left">
            <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-4 py-4">Company</th>
                <th className="px-4 py-4">Role</th>
                <th className="px-4 py-4">Email</th>
                <th className="px-4 py-4">Phone</th>
                <th className="px-4 py-4">Status</th>
                <th className="px-4 py-4">Last Login</th>
                <th className="px-4 py-4">Created At</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#edf2fb]">
              {result.users.map((user) => {
                const primaryRole = user.roles[0]?.role;
                return (
                  <tr key={user.id} className="transition hover:bg-[#fbfcff]">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(user.id)} text-sm font-semibold text-white`}>
                          {getInitials(user)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#122449]">{formatOptional(user.name)}</p>
                          <p className="truncate text-xs text-[#8092b2]">{getUserHandle(user)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#24406f]">
                      <div>
                        <p className="font-medium text-[#16315f]">{user.servicePartner.name}</p>
                        <p className="mt-1 text-xs text-[#8a9ab8]">{user.servicePartner.code}</p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getRoleBadgeTone(primaryRole?.key)}`}>
                        {primaryRole?.name ?? "Unassigned"}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#24406f]">{formatOptional(user.email)}</td>
                    <td className="px-4 py-4 text-sm text-[#24406f]">{formatOptional(user.phone)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(user.status)}`}>
                        {formatEnumLabel(user.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-[#24406f]">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "-"}</td>
                    <td className="px-4 py-4 text-sm text-[#24406f]">{formatDateTime(user.createdAt)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <PrefetchLink
                          href={`/users/${user.id}`}
                          className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]"
                          aria-label={`View ${formatOptional(user.name)}`}
                        >
                          <TableActionIcon kind="view" />
                        </PrefetchLink>
                        {canUpdate ? (
                          <PrefetchLink
                            href={`/users/${user.id}/edit`}
                            className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]"
                            aria-label={`Edit ${formatOptional(user.name)}`}
                          >
                            <TableActionIcon kind="edit" />
                          </PrefetchLink>
                        ) : null}
                        <PrefetchLink
                          href={`/users/${user.id}#roles`}
                          className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]"
                          aria-label={`Open roles for ${formatOptional(user.name)}`}
                        >
                          <TableActionIcon kind="roles" />
                        </PrefetchLink>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 p-4 lg:hidden">
          {result.users.map((user) => {
            const primaryRole = user.roles[0]?.role;
            return (
              <article key={user.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(user.id)} text-sm font-semibold text-white`}>
                      {getInitials(user)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#122449]">{formatOptional(user.name)}</p>
                      <p className="truncate text-xs text-[#8092b2]">{getUserHandle(user)}</p>
                    </div>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(user.status)}`}>
                    {formatEnumLabel(user.status)}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Company</p>
                    <p className="mt-1 text-sm text-[#16315f]">{user.servicePartner.name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Role</p>
                    <p className="mt-1 text-sm text-[#16315f]">{primaryRole?.name ?? "Unassigned"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Email</p>
                    <p className="mt-1 break-all text-sm text-[#16315f]">{formatOptional(user.email)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Phone</p>
                    <p className="mt-1 text-sm text-[#16315f]">{formatOptional(user.phone)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Last Login</p>
                    <p className="mt-1 text-sm text-[#16315f]">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "-"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Created</p>
                    <p className="mt-1 text-sm text-[#16315f]">{formatDateTime(user.createdAt)}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <PrefetchLink
                    href={`/users/${user.id}`}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]"
                  >
                    <TableActionIcon kind="view" />
                    <span>View</span>
                  </PrefetchLink>
                  {canUpdate ? (
                    <PrefetchLink
                      href={`/users/${user.id}/edit`}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]"
                    >
                      <TableActionIcon kind="edit" />
                      <span>Edit</span>
                    </PrefetchLink>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {result.users.length === 0 ? (
          <div className="border-t border-[#edf2fb] px-6 py-16 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </div>
            <h2 className="mt-5 text-xl font-semibold text-[#122449]">No users found</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
              Current filters ke hisab se koi user record nahi mila. Search ya dropdown filters reset karke dobara check karein.
            </p>
          </div>
        ) : null}

        {result.users.length > 0 ? (
          <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-[#7486a8]">
              Showing {showingFrom} to {showingTo} of {result.total} users
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {result.page > 1 ? (
                <Link
                  href={buildUsersHref({ ...currentFilters, page: result.page - 1 })}
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
                    href={buildUsersHref({ ...currentFilters, page: token })}
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
                  href={buildUsersHref({ ...currentFilters, page: result.page + 1 })}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </Link>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              {pageSizeOptions.map((size) => (
                <Link
                  key={size}
                  href={buildUsersHref({ ...currentFilters, page: 1, pageSize: size })}
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
        ) : null}
      </div>
    </section>
  );
}
