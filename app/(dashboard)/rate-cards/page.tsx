import { RateCardStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { RateCardsTable } from "@/features/rate-cards/components/rate-cards-table";
import { listClientsForRateCardForm, listRateCards } from "@/features/rate-cards/services/rate-card.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type RateCardsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

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

export default async function RateCardsPage({ searchParams }: RateCardsPageProps) {
  const session = await requirePermission("rate_cards.read");
  const [params, canCreate] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "rate_cards.create")]);

  const q = getStringParam(params, "q");
  const clientId = getStringParam(params, "clientId");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(RateCardStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, clients] = await Promise.all([
    listRateCards(session, { q, status, clientId, page, pageSize }),
    listClientsForRateCardForm(session),
  ]);

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (clientId) {
      next.set("clientId", clientId);
    }
    if (status) {
      next.set("status", status);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/rate-cards?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Rate Cards"
        description="Manage tenant-specific and client-specific rate cards."
        action={canCreate ? { label: "New rate card", href: "/rate-cards/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-4" action="">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by code or name"
          className="h-9 min-w-0 rounded-md border border-[var(--border)] px-3 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border border-[var(--border)] px-3 text-sm">
          <option value="">All statuses</option>
          {Object.values(RateCardStatus).map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {statusValue}
            </option>
          ))}
        </select>
        <select name="clientId" defaultValue={clientId ?? ""} className="h-9 rounded-md border border-[var(--border)] px-3 text-sm">
          <option value="">All clients / General</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} ({client.code})
            </option>
          ))}
        </select>
        <div>
          <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
            Apply
          </button>
        </div>
      </form>

      {result.rateCards.length === 0 ? (
        <EmptyState title="No rate cards found" description="Try adjusting filters or create a new rate card." />
      ) : (
        <>
          <RateCardsTable rateCards={result.rateCards} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} rate cards)
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
        </>
      )}
    </section>
  );
}

