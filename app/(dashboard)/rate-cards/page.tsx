import { RateCardStatus } from "@prisma/client";
import type { ReactNode } from "react";

import { deleteRateCardAction } from "@/features/rate-cards/actions/rate-card.actions";
import {
  getRateCardFilterOptions,
  getRateCardOverview,
  listClientsForRateCardForm,
  listRateCardServicePartnersForForm,
  listRateCards,
  listRecentRateCards,
  type RateCardListStatus,
} from "@/features/rate-cards/services/rate-card.service";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr } from "@/lib/utils/format";

type RateCardsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

type RateCardsResult = Awaited<ReturnType<typeof listRateCards>>;
type RateCardRow = RateCardsResult["rateCards"][number];

const pageSizeOptions = [8, 10, 20];

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Rate card deleted successfully.";
  }
  return undefined;
}

function toStatus(value?: string): RateCardListStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "EXPIRING_SOON") {
    return value;
  }
  return Object.values(RateCardStatus).find((status) => status === value);
}

function toDateValue(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildRateCardsHref(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `/rate-cards?${query}` : "/rate-cards";
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
    "from-[#ff647f] to-[#f53d5b]",
  ];
  const total = Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return tones[total % tones.length];
}

function getInitials(value: string) {
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatShortDate(value: Date) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function formatShortDateTime(value: Date) {
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
    return "No recent updates";
  }

  const diffMs = Date.now() - value.getTime();
  const diffMinutes = Math.max(Math.round(diffMs / 60000), 0);

  if (diffMinutes < 1) {
    return "Updated just now";
  }
  if (diffMinutes < 60) {
    return `Last updated: ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Last updated: ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `Last updated: ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function getDisplayStatusTone(status: RateCardListStatus) {
  if (status === "ACTIVE") {
    return "bg-[#eaf8ef] text-[#1d9d57]";
  }
  if (status === "EXPIRING_SOON") {
    return "bg-[#fff4e5] text-[#e7881d]";
  }
  if (status === "DRAFT") {
    return "bg-[#edf3ff] text-[#5f8dff]";
  }
  if (status === "INACTIVE") {
    return "bg-[#f1f4f9] text-[#7a8cac]";
  }
  return "bg-[#fff1f1] text-[#ff4f5e]";
}

function getDisplayStatusLabel(status: RateCardListStatus) {
  if (status === "EXPIRING_SOON") {
    return "Expiring Soon";
  }
  return status.charAt(0) + status.slice(1).toLowerCase().replace("_", " ");
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
      <p className="mt-1 text-[2rem] font-semibold leading-none tracking-[-0.04em] text-[#11244a]">{value.toLocaleString("en-IN")}</p>
      <p className="mt-2 text-sm text-[#8a9ab8]">{subtitle}</p>
    </article>
  );
}

function RowActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function RateCardPagination({
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
        <PrefetchLink href={buildRateCardsHref({ ...currentFilters, page: page - 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
      {visiblePages.map((token) =>
        typeof token === "number" ? (
          <PrefetchLink
            key={token}
            href={buildRateCardsHref({ ...currentFilters, page: token })}
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
        <PrefetchLink href={buildRateCardsHref({ ...currentFilters, page: page + 1 })} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dfe6f2] text-[#5d7197] transition hover:bg-[#f8faff]">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </PrefetchLink>
      ) : null}
    </div>
  );
}

function QuickActionCard({
  href,
  title,
  icon,
}: {
  href: string;
  title: string;
  icon: ReactNode;
}) {
  return (
    <PrefetchLink href={href} className="flex items-center gap-3 rounded-[18px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4 text-sm font-semibold text-[#173260] transition hover:border-[#d9e3ff] hover:bg-white">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-[#315cff] shadow-[0_8px_18px_rgba(49,92,255,0.10)]">{icon}</span>
      <span>{title}</span>
    </PrefetchLink>
  );
}

export default async function RateCardsPage({ searchParams }: RateCardsPageProps) {
  const session = await requirePermission("rate_cards.read");
  const [params, canCreate, canUpdate, canDelete, canPublish, clients, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "rate_cards.create"),
    hasPermission(session, "rate_cards.update"),
    hasPermission(session, "rate_cards.delete"),
    hasPermission(session, "rate_cards.publish"),
    listClientsForRateCardForm(session),
    listRateCardServicePartnersForForm(session),
  ]);

  const q = getStringParam(params, "q");
  const clientId = getStringParam(params, "clientId");
  const servicePartnerId = getStringParam(params, "servicePartnerId");
  const categoryId = getStringParam(params, "categoryId");
  const effectiveFromParam = getStringParam(params, "effectiveFrom");
  const effectiveFrom = toDateValue(effectiveFromParam);
  const status = toStatus(getStringParam(params, "status"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize") ?? 8;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, overview, recentRateCards, categories] = await Promise.all([
    listRateCards(session, { q, status, clientId, servicePartnerId, categoryId, effectiveFrom, page, pageSize }),
    getRateCardOverview(session, { q, clientId, servicePartnerId, categoryId, effectiveFrom }),
    listRecentRateCards(session, { q, clientId, servicePartnerId, categoryId, effectiveFrom }),
    getRateCardFilterOptions(session, { clientId, servicePartnerId, effectiveFrom }),
  ]);

  const currentFilters = {
    q,
    clientId,
    servicePartnerId,
    categoryId,
    status,
    effectiveFrom: effectiveFromParam,
    pageSize: result.pageSize,
  };
  const showingFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const showingTo = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[2.15rem] font-semibold tracking-[-0.05em] text-[#10244b]">RC Management</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#7082a6] sm:text-base">
            Manage rate cards, pricing rules, and service billing standards across all companies.
          </p>
        </div>

        <p className="text-sm font-medium text-[#7a8cad]">{formatRelativeUpdate(overview.latestUpdatedAt)}</p>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <rect x="5" y="3" width="14" height="18" rx="2.5" />
              <path d="M8 8h8M8 12h8M8 16h6" />
            </svg>
          }
          title="Active Rate Cards"
          value={overview.activeRateCards}
          subtitle="All companies"
          trend={`${overview.totalRateCards ? Math.round((overview.activeRateCards / overview.totalRateCards) * 100) : 0}%`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="m4 9 8-6 8 6v9l-8 3-8-3V9Z" />
              <path d="M12 3v18" />
            </svg>
          }
          title="Linked Categories"
          value={overview.linkedCategories}
          subtitle="All categories"
          trend={`${overview.linkedCategories} in use`}
          trendTone="bg-[#edf3ff] text-[#3f66ff]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
              <path d="M12 21V11" />
              <path d="m4 7 8 4 8-4" />
            </svg>
          }
          title="Linked Items"
          value={overview.linkedItems}
          subtitle="All items / services"
          trend={`${overview.totalRateCards ? Math.round(overview.linkedItems / Math.max(overview.totalRateCards, 1)) : 0} avg/RC`}
          trendTone="bg-[#ebf6ef] text-[#1b9c56]"
        />
        <StatCard
          icon={
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="8" />
              <path d="M12 8v4l3 2" />
            </svg>
          }
          title="Expiring Soon"
          value={overview.expiringSoon}
          subtitle="Next 30 days"
          trend={`${overview.totalRateCards ? Math.round((overview.expiringSoon / overview.totalRateCards) * 100) : 0}%`}
          trendTone="bg-[#fff4e5] text-[#e7881d]"
        />
      </div>

      <div className="rounded-[28px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)] sm:p-5">
        <form action="" className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_1fr_1fr_1fr_1fr_auto] xl:items-end">
          <input type="hidden" name="pageSize" value={result.pageSize} />

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Search</span>
            <span className="relative block">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8ea0bf]" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search rate cards..."
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] pl-12 pr-4 text-sm text-[#13305d] outline-none transition placeholder:text-[#93a2bf] focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              />
            </span>
          </label>

          {session.user.isSuperAdmin ? (
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Company</span>
              <select
                name="servicePartnerId"
                defaultValue={servicePartnerId ?? ""}
                className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
              >
                <option value="">All Companies</option>
                {servicePartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Client</span>
            <select
              name="clientId"
              defaultValue={clientId ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Clients / General</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Category</span>
            <select
              name="categoryId"
              defaultValue={categoryId ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
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
              <option value="">All Statuses</option>
              <option value={RateCardStatus.ACTIVE}>Active</option>
              <option value={RateCardStatus.DRAFT}>Draft</option>
              <option value="EXPIRING_SOON">Expiring Soon</option>
              <option value={RateCardStatus.INACTIVE}>Inactive</option>
              <option value={RateCardStatus.EXPIRED}>Expired</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#7a8cac]">Effective From</span>
            <input
              type="date"
              name="effectiveFrom"
              defaultValue={effectiveFromParam ?? ""}
              className="h-12 w-full rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 xl:justify-end">
            {canCreate ? (
              <PrefetchLink href="/rate-cards/new" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)] transition hover:brightness-105">
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 4v12M4 10h12" />
                </svg>
                <span>Add Rate Card</span>
              </PrefetchLink>
            ) : null}
            <button type="submit" className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#dbe4f2] bg-white px-4 text-sm font-semibold text-[#173260] transition hover:bg-[#f7f9fd]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 6h16l-6 7v5l-4-2v-3L4 6Z" />
              </svg>
              <span>Apply</span>
            </button>
            <span className="inline-flex min-h-12 items-center rounded-2xl border border-[#dbe4ff] bg-[#f7f9ff] px-4 text-sm font-semibold text-[#5d72a7]">
              Import and export stay hidden until real rate card file flows are available.
            </span>
          </div>
        </form>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.8fr)_420px]">
        <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
          <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
            <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Rate Card Directory</h2>
            <PrefetchLink href="/rate-cards" className="text-sm font-semibold text-[#315cff]">
              View all
            </PrefetchLink>
          </div>

          {result.rateCards.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#eef3ff] text-[#315cff]">
                <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.9">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <h2 className="mt-5 text-xl font-semibold text-[#122449]">No rate cards found</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7486a8]">
                Current filters ke hisab se koi rate card record nahi mila. Search ya filters reset karke dobara check karein.
              </p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-full text-left">
                  <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
                    <tr>
                      <th className="px-5 py-4">Rate Card No.</th>
                      <th className="px-4 py-4">Company</th>
                      <th className="px-4 py-4">Category</th>
                      <th className="px-4 py-4">Item / Service</th>
                      <th className="px-4 py-4">Line Count</th>
                      <th className="px-4 py-4">Avg. Unit Rate</th>
                      <th className="px-4 py-4">Effective From</th>
                      <th className="px-4 py-4">Status</th>
                      <th className="px-5 py-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf2fb]">
                    {result.rateCards.map((rateCard) => {
                      const displayStatus = rateCard.summary.displayStatus;
                      return (
                        <tr key={rateCard.id} className="transition hover:bg-[#fbfcff]">
                          <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{rateCard.code}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{rateCard.client?.name ?? rateCard.servicePartner.name}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{rateCard.lines[0]?.item.category.name ?? "-"}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{rateCard.summary.primaryItem?.name ?? "No line items"}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{rateCard.summary.linkedItems}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{rateCard.summary.averageRate !== null ? formatCurrencyInr(rateCard.summary.averageRate) : "-"}</td>
                          <td className="px-4 py-4 text-sm text-[#24406f]">{formatShortDate(rateCard.effectiveFrom)}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getDisplayStatusTone(displayStatus)}`}>
                              {getDisplayStatusLabel(displayStatus)}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <PrefetchLink href={`/rate-cards/${rateCard.id}`} className="grid h-9 w-9 place-items-center rounded-xl border border-[#dfe6f2] text-[#315cff] transition hover:bg-[#f6f8ff]" aria-label={`View ${rateCard.name}`}>
                                <RowActionIcon />
                              </PrefetchLink>
                              {canUpdate ? (
                                <PrefetchLink href={`/rate-cards/${rateCard.id}/edit`} className="text-xs font-semibold text-[#315cff]">
                                  Edit
                                </PrefetchLink>
                              ) : null}
                              {canDelete ? (
                                <form action={deleteRateCardAction.bind(null, rateCard.id)}>
                                  <input type="hidden" name="redirectTo" value="/rate-cards" />
                                  <button type="submit" className="text-xs font-semibold text-[#ff4f5e]">
                                    Delete
                                  </button>
                                </form>
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
                {result.rateCards.map((rateCard) => (
                  <article key={rateCard.id} className="rounded-[24px] border border-[#e8edf6] bg-[#fbfcff] p-4 shadow-[0_10px_26px_rgba(23,52,110,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122449]">{rateCard.name}</p>
                        <p className="mt-1 truncate text-xs text-[#8092b2]">{rateCard.code}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getDisplayStatusTone(rateCard.summary.displayStatus)}`}>
                        {getDisplayStatusLabel(rateCard.summary.displayStatus)}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Client / Company</p>
                        <p className="mt-1 text-sm text-[#16315f]">{rateCard.client?.name ?? rateCard.servicePartner.name}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Primary Item</p>
                        <p className="mt-1 text-sm text-[#16315f]">{rateCard.summary.primaryItem?.name ?? "-"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Lines</p>
                        <p className="mt-1 text-sm text-[#16315f]">{rateCard.summary.linkedItems}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">Avg Rate</p>
                        <p className="mt-1 text-sm text-[#16315f]">{rateCard.summary.averageRate !== null ? formatCurrencyInr(rateCard.summary.averageRate) : "-"}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>

              <div className="flex flex-col gap-4 border-t border-[#edf2fb] px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-[#7486a8]">
                  Showing {showingFrom} to {showingTo} of {result.total} rate cards
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  {pageSizeOptions.map((size) => (
                    <PrefetchLink
                      key={size}
                      href={buildRateCardsHref({ ...currentFilters, page: 1, pageSize: size })}
                      className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                        size === result.pageSize ? "border-[#dbe3ff] bg-[#eef2ff] text-[#315cff]" : "border-[#dfe6f2] text-[#6f82a4] hover:bg-[#f8faff]"
                      }`}
                    >
                      {size}
                    </PrefetchLink>
                  ))}
                </div>

                <RateCardPagination page={result.page} totalPages={result.totalPages} currentFilters={currentFilters} />
              </div>
            </>
          )}
        </div>

        <div className="space-y-5">
          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Quick Actions</h2>
            </div>
            <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
              {canCreate ? (
                <QuickActionCard
                  href="/rate-cards/new"
                  title="Add Rate Card"
                  icon={
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <rect x="5" y="3" width="14" height="18" rx="2.5" />
                      <path d="M8 8h8M8 12h8M8 16h6" />
                    </svg>
                  }
                />
              ) : null}
              <QuickActionCard
                href="/categories/new"
                title="Add Category"
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="m4 9 8-6 8 6v9l-8 3-8-3V9Z" />
                  </svg>
                }
              />
              <QuickActionCard
                href="/items/new"
                title="Add Item"
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
                  </svg>
                }
              />
              <QuickActionCard
                href="/rate-cards"
                title="Review Expiring Rates"
                icon={
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <circle cx="12" cy="12" r="8" />
                    <path d="M12 8v4l3 2" />
                  </svg>
                }
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
            <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
              <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Alerts / Pending Actions</h2>
            </div>
            <div className="divide-y divide-[#edf2fb]">
              {[
                { label: "Expiring Rate Cards", subtitle: "Next 30 days", count: overview.expiringSoon, tone: "text-[#ff9a1a] bg-[#fff4e5]" },
                { label: "Draft Rate Cards", subtitle: "Pending activation", count: overview.draftRateCards, tone: "text-[#5f8dff] bg-[#edf3ff]" },
                { label: "Missing Item Mapping", subtitle: "No lines configured", count: overview.missingItemMapping, tone: "text-[#ff4f5e] bg-[#fff1f1]" },
                { label: "Inactive / Expired", subtitle: "Needs review", count: overview.inactiveRateCards + overview.expiredRateCards, tone: "text-[#875bff] bg-[#f3eaff]" },
              ].map((alert) => (
                <div key={alert.label} className="flex items-center gap-4 px-5 py-4">
                  <div className={`grid h-11 w-11 place-items-center rounded-full ${alert.tone}`}>
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9">
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                      <circle cx="12" cy="12" r="8" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#122449]">{alert.label}</p>
                    <p className="mt-1 text-xs text-[#8092b2]">{alert.subtitle}</p>
                  </div>
                  <span className={`rounded-2xl px-3 py-1 text-sm font-semibold ${alert.tone}`}>{alert.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[30px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <div className="flex items-center justify-between border-b border-[#edf2fb] px-5 py-4">
          <h2 className="text-[1.2rem] font-semibold tracking-[-0.02em] text-[#122449]">Recently Updated Rate Cards</h2>
          <PrefetchLink href="/rate-cards" className="text-sm font-semibold text-[#315cff]">
            View all
          </PrefetchLink>
        </div>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2 xl:grid-cols-6">
          {recentRateCards.map((rateCard) => (
            <article key={rateCard.id} className="rounded-[22px] border border-[#e8edf6] bg-[#fbfcff] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className={`grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br ${getAvatarTone(rateCard.code)} text-sm font-semibold text-white`}>
                  {getInitials(rateCard.code)}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-[#8092b2]">{rateCard.code}</p>
                  <p className="mt-1 truncate text-sm font-semibold text-[#122449]">{rateCard.client?.name ?? rateCard.servicePartner.name}</p>
                  <p className="mt-1 text-xs text-[#8092b2]">Updated {formatShortDateTime(rateCard.updatedAt)}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
