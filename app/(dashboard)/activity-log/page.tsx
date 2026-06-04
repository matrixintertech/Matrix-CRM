import Link from "next/link";

import { ExportActions } from "@/components/admin/export-actions";
import { PageHeader } from "@/components/admin/page-header";
import { listActivityLogs } from "@/features/activity-log/services/activity-log.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime } from "@/lib/utils/format";

type ActivityLogPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

export default async function ActivityLogPage({ searchParams }: ActivityLogPageProps) {
  const session = await requirePermission("activity_logs.read");
  const params = await resolveSearchParams(searchParams);
  const canExport = await hasPermission(session, "activity_logs.export");
  const q = getStringParam(params, "q");
  const action = getStringParam(params, "action");
  const moduleFilter = getStringParam(params, "module");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const dateFrom = getStringParam(params, "dateFrom");
  const dateTo = getStringParam(params, "dateTo");

  const result = await listActivityLogs(session, {
    q,
    action,
    module: moduleFilter,
    page,
    pageSize,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
  });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (action) next.set("action", action);
    if (moduleFilter) next.set("module", moduleFilter);
    if (dateFrom) next.set("dateFrom", dateFrom);
    if (dateTo) next.set("dateTo", dateTo);
    if (result.pageSize !== 20) next.set("pageSize", String(result.pageSize));
    next.set("page", String(nextPage));
    return `/activity-log?${next.toString()}`;
  }

  return (
    <section className="crm-page">
      <PageHeader title="Activity Log" description="Permission-gated audit trail for operational activity across CRM modules." />

      <div className="crm-panel">
        <form action="/activity-log" method="get" className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Search</span>
              <input defaultValue={q ?? ""} name="q" className="h-9 rounded-md border border-[var(--border)] px-3" placeholder="Search logs" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Action</span>
              <input defaultValue={action ?? ""} name="action" className="h-9 rounded-md border border-[var(--border)] px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Module</span>
              <input defaultValue={moduleFilter ?? ""} name="module" className="h-9 rounded-md border border-[var(--border)] px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Date From</span>
              <input type="date" defaultValue={dateFrom ?? ""} name="dateFrom" className="h-9 rounded-md border border-[var(--border)] px-3" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Date To</span>
              <input type="date" defaultValue={dateTo ?? ""} name="dateTo" className="h-9 rounded-md border border-[var(--border)] px-3" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="rounded-md bg-[var(--primary)] px-3 py-2 text-sm font-medium text-white">
              Apply
            </button>
            {canExport ? (
              <ExportActions
                moduleKey="activity-logs"
                query={{
                  q,
                  action,
                  module: moduleFilter,
                  dateFrom,
                  dateTo,
                }}
              />
            ) : null}
          </div>
        </form>

        <div className="overflow-x-auto rounded-md border border-[var(--border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-3 py-2">Timestamp</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Module</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Entity</th>
                <th className="px-3 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {result.logs.map((log) => (
                <tr key={log.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">{formatDateTime(log.createdAt)}</td>
                  <td className="px-3 py-2">{log.servicePartner.name}</td>
                  <td className="px-3 py-2">{log.actor?.name || log.actor?.email || "-"}</td>
                  <td className="px-3 py-2">{log.module}</td>
                  <td className="px-3 py-2">{log.action}</td>
                  <td className="px-3 py-2">{`${log.entityType}${log.entityId ? ` / ${log.entityId}` : ""}`}</td>
                  <td className="px-3 py-2">{log.message || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.logs.length === 0 ? <p className="px-3 py-4 text-sm text-[var(--muted)]">No activity logs found.</p> : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-[var(--muted)]">
            Page {result.page} of {result.totalPages} ({result.total} logs)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 ? (
              <Link href={buildPageHref(result.page - 1)} className="rounded-md border border-slate-200 px-3 py-2">
                Previous
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link href={buildPageHref(result.page + 1)} className="rounded-md border border-slate-200 px-3 py-2">
                Next
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
