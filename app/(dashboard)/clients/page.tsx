import { ClientStatus } from "@prisma/client";
import type { ReactNode } from "react";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import {
  getClientOverview,
  listClientFilterOptions,
  listClients,
  listClientServicePartnersForForm,
  listRecentClients,
} from "@/features/clients/services/client.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime } from "@/lib/utils/format";

type ClientsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type ClientsResult = Awaited<ReturnType<typeof listClients>>;
type ClientRow = ClientsResult["clients"][number];

const pageSizeOptions = [10, 20, 25];

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Client deleted successfully.";
  }
  return undefined;
}

function buildClientsHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/clients?${query}` : "/clients";
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

function getInitials(name: string) {
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getStatusTone(status: ClientRow["status"]) {
  if (status === "ACTIVE") {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === "ON_HOLD") {
    return "bg-[#fff4e5] text-[#e7881d]";
  }
  return "bg-[#edf3ff] text-[#3f66ff]";
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

function RowActionIcon({ kind }: { kind: "view" | "more" }) {
  if (kind === "view") {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
        <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function buildDonutGradient(active: number, inactive: number, onHold: number) {
  const total = active + inactive + onHold || 1;
  const activeEnd = Math.round((active / total) * 360);
  const inactiveEnd = activeEnd + Math.round((inactive / total) * 360);
  return `conic-gradient(#1fb15a 0deg ${activeEnd}deg, #b8c5df ${activeEnd}deg ${inactiveEnd}deg, #f59a23 ${inactiveEnd}deg 360deg)`;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const session = await requirePermission("clients.read");
  const [params, canCreate, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "clients.create"),
    listClientServicePartnersForForm(session),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const state = getStringParam(params, "state");
  const city = getStringParam(params, "city");
  const status = Object.values(ClientStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 10;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, filterOptions, recentClients] = await Promise.all([
    listClients(session, { q, status, servicePartnerId, state, city, page, pageSize }),
    getClientOverview(session, { status, servicePartnerId, state, city }),
    listClientFilterOptions(session),
    listRecentClients(session, { status, servicePartnerId, state, city }),
  ]);

  const currentFilters = {
    q,
    status,
    servicePartnerId,
    state,
    city,
    pageSize: result.pageSize,
  };
  const visiblePages = getPageTokens(result.page, result.totalPages);
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);
  const donutGradient = buildDonutGradient(overview.activeClients, overview.inactiveClients, overview.pendingClients);
  const totalDistribution = overview.activeClients + overview.inactiveClients + overview.pendingClients || 1;

  return (
    <section className="space-y-6">
      <div className="relative overflow-hidden rounded-[32px] border border-[#e7ecf7] bg-[radial-gradient(circle_at_top_left,_rgba(85,96,255,0.10),_transparent_32%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(249,251,255,0.98))] p-6 shadow-[0_18px_44px_rgba(16,40,88,0.06)] sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#cad6ff] to-transparent" />
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#7a8cad]">Organization</p>
            <h1 className="mt-3 text-[2.25rem] font-semibold tracking-[-0.05em] text-[#10244b]">Clients</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
              Manage and view all client companies across the platform.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 9 0" /><path d="M11.5 19a5.5 5.5 0 0 1 9 0" /></svg>}
            title="Total Clients"
            value={overview.totalClients}
            subtitle="All client companies"
            trend={`${overview.totalClients ? Math.round((overview.activeClients / overview.totalClients) * 100) : 0}% active`}
            trendTone="bg-[#f3eaff] text-[#8747f4]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 20h16" /><path d="M7 20V6h10v14" /><path d="M10 10h.01M14 10h.01M10 14h.01M14 14h.01" /></svg>}
            title="Active Clients"
            value={overview.activeClients}
            subtitle="Currently active"
            trend={`${overview.totalClients ? Math.round((overview.activeClients / overview.totalClients) * 100) : 0}%`}
            trendTone="bg-[#ebf6ef] text-[#1b9c56]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="9" cy="8" r="3" /><path d="M4 18a5 5 0 0 1 10 0" /><path d="M17 7v6M14 10h6" /></svg>}
            title="Added This Month"
            value={overview.addedThisMonth}
            subtitle="New clients"
            trend={`${overview.totalClients ? Math.round((overview.addedThisMonth / overview.totalClients) * 100) : 0}%`}
            trendTone="bg-[#edf3ff] text-[#3f66ff]"
          />
          <StatCard
            icon={<svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M4 11 12 5l8 6" /><path d="M6 10v8h12v-8" /><path d="M10 14h4" /></svg>}
            title="Linked Service Partners"
            value={overview.linkedServicePartners}
            subtitle="Serving clients"
            trend={`${servicePartners.length ? Math.round((overview.linkedServicePartners / servicePartners.length) * 100) : 0}%`}
            trendTone="bg-[#fff4e5] text-[#e7881d]"
          />
        </div>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_340px]">
        <div className="space-y-5">
          <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
            <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_0.9fr_0.9fr_0.9fr_0.9fr_auto] xl:items-end">
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
                    defaultValue={q}
                    placeholder="Search clients by name, contact, email or phone..."
                    className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
                  />
                </span>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Service Partner</span>
                <select name="servicePartnerId" defaultValue={servicePartnerId ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All Partners</option>
                  {servicePartners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Status</span>
                <select name="status" defaultValue={status ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All Status</option>
                  {Object.values(ClientStatus).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">State</span>
                <select name="state" defaultValue={state ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All States</option>
                  {filterOptions.states.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">City</span>
                <select name="city" defaultValue={city ?? ""} className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]">
                  <option value="">All Cities</option>
                  {filterOptions.cities.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                  Filters
                </button>
                {canCreate ? (
                  <PrefetchLink href="/clients/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4v12M4 10h12" /></svg>
                    <span>Add Client</span>
                  </PrefetchLink>
                ) : null}
              </div>
            </form>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-6 py-5">
              <h2 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-[#122449]">All Clients ({overview.totalClients})</h2>
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full text-left">
                <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                  <tr>
                    <th className="px-6 py-4">Client Name</th>
                    <th className="px-4 py-4">Company / Service Partner</th>
                    <th className="px-4 py-4">Contact Person</th>
                    <th className="px-4 py-4">Email</th>
                    <th className="px-4 py-4">Phone</th>
                    <th className="px-4 py-4">State</th>
                    <th className="px-4 py-4">City</th>
                    <th className="px-4 py-4">Status</th>
                    <th className="px-4 py-4">Created On</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf2fb]">
                  {result.clients.map((client) => (
                    <tr key={client.id} className="transition hover:bg-[#fbfcff]">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(client.code)} text-sm font-semibold text-white`}>
                            {getInitials(client.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#122449]">{client.name}</p>
                            <p className="truncate text-xs text-[#8092b2]">{client.code}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">
                        <div>
                          <p className="font-medium text-[#16315f]">{client.servicePartner.name}</p>
                          <p className="mt-1 text-xs text-[#8a9ab8]">{client.servicePartner.code}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">
                        <div>
                          <p className="font-medium text-[#16315f]">{client.primaryContact?.name ?? client.primaryContact?.email ?? "-"}</p>
                          <p className="mt-1 text-xs text-[#8a9ab8]">{client.primaryContact?.designation ?? "-"}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{client.email ?? "-"}</td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{client.phone ?? "-"}</td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{client.state ?? "-"}</td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{client.city ?? "-"}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(client.status)}`}>
                          {client.status === "ON_HOLD" ? "On Hold" : client.status.charAt(0) + client.status.slice(1).toLowerCase()}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-sm text-[#24406f]">{formatDateTime(client.createdAt)}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <PrefetchLink href={`/clients/${client.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${client.name}`}>
                            <RowActionIcon kind="view" />
                          </PrefetchLink>
                          <PrefetchLink href={`/clients/${client.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`More actions for ${client.name}`}>
                            <RowActionIcon kind="more" />
                          </PrefetchLink>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-4 p-4 lg:hidden">
              {result.clients.map((client) => (
                <article key={client.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(client.code)} text-sm font-semibold text-white`}>
                        {getInitials(client.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{client.name}</p>
                        <p className="truncate text-xs text-[#8092b2]">{client.code}</p>
                      </div>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusTone(client.status)}`}>
                      {client.status === "ON_HOLD" ? "On Hold" : client.status.charAt(0) + client.status.slice(1).toLowerCase()}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Partner</p><p className="mt-1 text-sm text-[#16315f]">{client.servicePartner.name}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Contact</p><p className="mt-1 text-sm text-[#16315f]">{client.primaryContact?.name ?? client.primaryContact?.email ?? "-"}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Email</p><p className="mt-1 break-all text-sm text-[#16315f]">{client.email ?? "-"}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Phone</p><p className="mt-1 text-sm text-[#16315f]">{client.phone ?? "-"}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">State / City</p><p className="mt-1 text-sm text-[#16315f]">{client.state ?? "-"} / {client.city ?? "-"}</p></div>
                    <div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Created</p><p className="mt-1 text-sm text-[#16315f]">{formatDateTime(client.createdAt)}</p></div>
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <PrefetchLink href={`/clients/${client.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[#dfe6f2] px-4 text-sm font-semibold text-[#315cff]">
                      <RowActionIcon kind="view" />
                      <span>View</span>
                    </PrefetchLink>
                  </div>
                </article>
              ))}
            </div>

            {result.clients.length === 0 ? (
              <div className="border-t border-[#edf2fb] px-6 py-16 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                </div>
                <h2 className="mt-5 text-xl font-semibold text-[#122449]">No clients found</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">Current filters ke hisab se koi client record nahi mila. Search ya dropdown filters reset karke dobara check karein.</p>
              </div>
            ) : null}

            {result.clients.length > 0 ? (
              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">Showing {showingFrom} to {showingTo} of {result.total} clients</p>

                <div className="flex flex-wrap items-center gap-2">
                  {result.page > 1 ? (
                    <PrefetchLink href={buildClientsHref({ ...currentFilters, page: result.page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 6-6 6 6 6" /></svg>
                    </PrefetchLink>
                  ) : null}
                  {visiblePages.map((token) =>
                    typeof token === "number" ? (
                      <PrefetchLink
                        key={token}
                        href={buildClientsHref({ ...currentFilters, page: token })}
                        className={`grid h-10 min-w-10 place-items-center rounded-xl border px-3 text-sm font-semibold transition ${
                          token === result.page ? "border-[#4f61ff] bg-gradient-to-r from-[#585eff] to-[#3267ff] text-white shadow-[0_12px_24px_rgba(50,103,255,0.24)]" : "border-[#dfe6f2] text-[#5d7197] hover:bg-[#f8faff]"
                        }`}
                      >
                        {token}
                      </PrefetchLink>
                    ) : (
                      <span key={token} className="px-1 text-sm text-[#8ea0bf]">...</span>
                    )
                  )}
                  {result.page < result.totalPages ? (
                    <PrefetchLink href={buildClientsHref({ ...currentFilters, page: result.page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 6 6 6-6 6" /></svg>
                    </PrefetchLink>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <PrefetchLink href="/clients" className="rounded-xl border border-[#dfe6f2] px-3 py-2 text-sm font-semibold text-[#6f82a4] transition hover:bg-[#f8faff]">Reset</PrefetchLink>
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildClientsHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size} / page
                    </PrefetchLink>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recent Clients</h2>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {recentClients.map((client) => (
                <PrefetchLink key={client.id} href={`/clients/${client.id}`} className="flex items-start gap-3 px-5 py-4 transition hover:bg-[#fbfcff]">
                  <div className={`grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br ${getAvatarTone(client.code)} text-sm font-semibold text-white`}>
                    {getInitials(client.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#122449]">{client.name}</p>
                    <p className="mt-1 text-xs text-[#8092b2]">{formatDateTime(client.createdAt)}</p>
                  </div>
                </PrefetchLink>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Top States</h2>
            </div>
            <div className="space-y-4 px-5 py-5">
              {overview.stateCounts.map((entry) => (
                <div key={entry.state}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#173260]">{entry.state}</span>
                    <span className="text-[#6f82a4]">{entry.count}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[#eef2fb]">
                    <div className="h-2 rounded-full bg-[#315cff]" style={{ width: `${Math.round((entry.count / Math.max(overview.totalClients, 1)) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Client Distribution</h2>
            </div>
            <div className="px-5 py-5">
              <div className="mx-auto flex max-w-[250px] items-center justify-center">
                <div className="relative grid h-40 w-40 place-items-center rounded-full" style={{ background: donutGradient }}>
                  <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-[inset_0_0_0_1px_rgba(229,236,247,0.9)]">
                    <div>
                      <p className="text-[2rem] font-semibold leading-none text-[#11244a]">{overview.totalClients}</p>
                      <p className="mt-2 text-sm font-medium text-[#6f82a4]">Total</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <div className="flex items-center justify-between text-sm"><div className="flex items-center gap-3"><span className="block h-2.5 w-2.5 rounded-full bg-[#1fb15a]" /><span className="text-[#173260]">Active</span></div><span className="text-[#6f82a4]">{overview.activeClients} ({Math.round((overview.activeClients / totalDistribution) * 100)}%)</span></div>
                <div className="flex items-center justify-between text-sm"><div className="flex items-center gap-3"><span className="block h-2.5 w-2.5 rounded-full bg-[#b8c5df]" /><span className="text-[#173260]">Inactive</span></div><span className="text-[#6f82a4]">{overview.inactiveClients} ({Math.round((overview.inactiveClients / totalDistribution) * 100)}%)</span></div>
                <div className="flex items-center justify-between text-sm"><div className="flex items-center gap-3"><span className="block h-2.5 w-2.5 rounded-full bg-[#f59a23]" /><span className="text-[#173260]">On Hold</span></div><span className="text-[#6f82a4]">{overview.pendingClients} ({Math.round((overview.pendingClients / totalDistribution) * 100)}%)</span></div>
              </div>

              <div className="mt-5 border-t border-[#edf2fb] pt-4 text-sm text-[#7082a6]">Updated {new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date())}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
