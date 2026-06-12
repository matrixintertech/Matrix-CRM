import type { ReactNode } from "react";

import { ExportActions } from "@/components/admin/export-actions";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { getActivityLogOverview, listActivityLogs } from "@/features/activity-log/services/activity-log.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ActivityLogPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const pageSizeOptions = [10, 20, 25];

function buildActivityLogHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/activity-log?${query}` : "/activity-log";
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

function formatShortDate(value: Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatShortDateTime(value: Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatRelativeUpdate(value: Date | null) {
  if (!value) {
    return "No recent activity";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);
  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Last activity: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last activity: ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `Last activity: ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function formatModuleLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  value: string;
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

function ActivityLogPagination({
  page,
  totalPages,
  currentFilters,
}: {
  page: number;
  totalPages: number;
  currentFilters: Record<string, string | number | undefined>;
}) {
  const visiblePages = getPageTokens(page, totalPages);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <PrefetchLink href={buildActivityLogHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildActivityLogHref({ ...currentFilters, page: token })}
            className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
              token === page
                ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]"
                : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
            }`}
          >
            {token}
          </PrefetchLink>
        ) : (
          <span key={token} className="px-1 text-sm text-[#8ea0bf]">
            ...
          </span>
        )
      )}
      {page < totalPages ? (
        <PrefetchLink href={buildActivityLogHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

export default async function ActivityLogPage({ searchParams }: ActivityLogPageProps) {
  const session = await requirePermission("activity_logs.read");
  const [params, canExport] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "activity_logs.export")]);
  const q = getStringParam(params, "q");
  const action = getStringParam(params, "action");
  const moduleFilter = getStringParam(params, "module");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const dateFrom = getStringParam(params, "dateFrom");
  const dateTo = getStringParam(params, "dateTo");

  const [result, overview] = await Promise.all([
    listActivityLogs(session, {
      q,
      action,
      module: moduleFilter,
      page,
      pageSize,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    }),
    getActivityLogOverview(session, {
      q,
      action,
      module: moduleFilter,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
    }),
  ]);

  const currentFilters = {
    q,
    action,
    module: moduleFilter,
    dateFrom,
    dateTo,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const dateRangeLabel = dateFrom || dateTo ? `${dateFrom || "Start"} to ${dateTo || "Now"}` : "All time";

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">Activity Log</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Permission-gated audit trail for operational activity across CRM modules.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(overview.latestCreatedAt)}</p>
          {canExport ? (
            <ExportActions
              moduleKey="activity-logs"
              query={{ q, action, module: moduleFilter, dateFrom, dateTo }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M7 4h10v16H7z" />
              <path d="M10 8h4M10 12h4M10 16h4" />
            </svg>
          }
          title="Total Logs"
          value={overview.totalLogs.toLocaleString("en-IN")}
          subtitle="Filtered records"
          trend={dateRangeLabel}
          trendTone="bg-[#edf3ff] text-[#315cff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="4" y="6" width="16" height="12" rx="2.5" />
              <path d="M8 10h8M8 14h5" />
            </svg>
          }
          title="Modules Covered"
          value={overview.moduleBreakdown.length.toLocaleString("en-IN")}
          subtitle="Top modules in current view"
          trend={moduleFilter ? formatModuleLabel(moduleFilter) : "All modules"}
          trendTone="bg-[#ecfbf2] text-[#1d9d57]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </svg>
          }
          title="Tracked Actions"
          value={overview.actionBreakdown.length.toLocaleString("en-IN")}
          subtitle="Most frequent actions"
          trend={action || "All actions"}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="8" r="3" />
              <path d="M5 20c1.5-3.5 4.1-5.5 7-5.5S17.5 16.5 19 20" />
            </svg>
          }
          title="Active Actors"
          value={overview.actorBreakdown.length.toLocaleString("en-IN")}
          subtitle="Most visible users"
          trend={overview.actorBreakdown[0]?.label ?? "No actor"}
          trendTone="bg-[#f3eaff] text-[#8747f4]"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_380px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="border-b border-[#edf2fb] px-4 py-4 sm:px-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr_1fr_auto] xl:items-end">
              <input type="hidden" name="pageSize" value={result.pageSize} />

              <label className="block">
                <span className="relative block">
                  <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    name="q"
                    defaultValue={q ?? ""}
                    placeholder="Search action, module, message, actor..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Action</span>
                <input
                  name="action"
                  defaultValue={action ?? ""}
                  placeholder="Action key"
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Module</span>
                <input
                  name="module"
                  defaultValue={moduleFilter ?? ""}
                  placeholder="Module key"
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Date From</span>
                <input
                  type="date"
                  name="dateFrom"
                  defaultValue={dateFrom ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Date To</span>
                <input
                  type="date"
                  name="dateTo"
                  defaultValue={dateTo ?? ""}
                  className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff] transition hover:bg-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
                  </svg>
                  <span>Filter</span>
                </button>
                <PrefetchLink href="/activity-log" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold text-[#7a8cac] transition hover:text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4v5h.6m14.8 2A7.5 7.5 0 0 0 6.6 8.7L4.6 9" />
                    <path d="M20 20v-5h-.6m-14.8-2A7.5 7.5 0 0 0 17.4 15.3l2-.3" />
                  </svg>
                  <span>Reset</span>
                </PrefetchLink>
              </div>
            </form>
          </div>

          {result.logs.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No activity logs found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi audit entry nahi mili. Search ya date filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Timestamp</th>
                      <th className="px-4 py-4">Company</th>
                      <th className="px-4 py-4">Actor</th>
                      <th className="px-4 py-4">Module</th>
                      <th className="px-4 py-4">Action</th>
                      <th className="px-4 py-4">Entity</th>
                      <th className="px-5 py-4">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.logs.map((log) => (
                      <tr key={log.id} className="transition hover:bg-[#fbfcff]">
                        <td className="px-5 py-4 text-sm text-[#173260]">{formatShortDateTime(log.createdAt)}</td>
                        <td className="px-4 py-4 text-sm text-[#173260]">{log.servicePartner.name}</td>
                        <td className="px-4 py-4 text-sm text-[#173260]">{log.actor?.name || log.actor?.email || "-"}</td>
                        <td className="px-4 py-4">
                          <span className="inline-flex rounded-full bg-[#edf3ff] px-3 py-1 text-xs font-semibold text-[#315cff]">
                            {formatModuleLabel(log.module)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-[#315cff]">{log.action}</td>
                        <td className="px-4 py-4 text-sm text-[#173260]">{`${log.entityType}${log.entityId ? ` / ${log.entityId}` : ""}`}</td>
                        <td className="px-5 py-4 text-sm text-[#6f82a4]">{log.message || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-4 p-4 lg:hidden">
                {result.logs.map((log) => (
                  <article key={log.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{log.action}</p>
                        <p className="mt-1 text-xs text-[#8092b2]">{formatShortDateTime(log.createdAt)}</p>
                      </div>
                      <span className="inline-flex rounded-full bg-[#edf3ff] px-3 py-1 text-xs font-semibold text-[#315cff]">
                        {formatModuleLabel(log.module)}
                      </span>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Company</p>
                        <p className="mt-1 text-sm text-[#16315f]">{log.servicePartner.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Actor</p>
                        <p className="mt-1 text-sm text-[#16315f]">{log.actor?.name || log.actor?.email || "-"}</p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Entity</p>
                        <p className="mt-1 break-all text-sm text-[#16315f]">{`${log.entityType}${log.entityId ? ` / ${log.entityId}` : ""}`}</p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Message</p>
                        <p className="mt-1 text-sm text-[#16315f]">{log.message || "-"}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} logs
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildActivityLogHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <ActivityLogPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top Modules</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.moduleBreakdown.length === 0 ? (
                <p className="text-sm text-[#7486a8]">No module activity.</p>
              ) : (
                overview.moduleBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-[#173260]">{formatModuleLabel(entry.label)}</span>
                    <span className="font-semibold text-[#315cff]">{entry.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top Actions</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.actionBreakdown.length === 0 ? (
                <p className="text-sm text-[#7486a8]">No actions found.</p>
              ) : (
                overview.actionBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-[#173260]">{entry.label}</span>
                    <span className="font-semibold text-[#315cff]">{entry.count}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top Actors</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.actorBreakdown.length === 0 ? (
                <p className="text-sm text-[#7486a8]">No actor activity.</p>
              ) : (
                overview.actorBreakdown.map((entry) => (
                  <div key={entry.key} className="flex items-center gap-3">
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-[#edf3ff] text-[#315cff]">
                      <span className="text-xs font-semibold">{entry.label.slice(0, 2).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#122449]">{entry.label}</p>
                    </div>
                    <span className="text-sm font-semibold text-[#173260]">{entry.count}</span>
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
