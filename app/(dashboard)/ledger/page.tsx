import { LedgerSourceType } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { LedgerFilters } from "@/features/ledger/components/ledger-filters";
import { LedgerSummaryCard } from "@/features/ledger/components/ledger-summary-card";
import { LedgerTable } from "@/features/ledger/components/ledger-table";
import { listLedgerEntries } from "@/features/ledger/services/ledger.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type LedgerPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

export default async function LedgerPage({ searchParams }: LedgerPageProps) {
  const session = await requirePermission("ledger.read");
  const params = await resolveSearchParams(searchParams);

  const q = getStringParam(params, "q");
  const sourceTypeParam = getStringParam(params, "sourceType");
  const sourceType = Object.values(LedgerSourceType).find((value) => value === sourceTypeParam);
  const dateFrom = getStringParam(params, "dateFrom");
  const dateTo = getStringParam(params, "dateTo");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");

  const result = await listLedgerEntries(session, {
    q,
    sourceType,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
    page,
    pageSize,
  });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (sourceType) {
      next.set("sourceType", sourceType);
    }
    if (dateFrom) {
      next.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      next.set("dateTo", dateTo);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/ledger?${next.toString()}`;
  }

  return (
    <section className="crm-page">
      <PageHeader title="Ledger" description="Tenant-scoped ledger entries generated from invoice payment postings." />

      <LedgerSummaryCard
        entriesCount={result.summary.entriesCount}
        totalDebit={result.summary.totalDebit}
        totalCredit={result.summary.totalCredit}
        netAmount={result.summary.netAmount}
      />

      <LedgerFilters q={q} sourceType={sourceType} dateFrom={dateFrom} dateTo={dateTo} />

      {result.entries.length === 0 ? (
        <EmptyState title="No ledger entries found" description="Try adjusting filters or record an invoice payment." />
      ) : (
        <>
          <LedgerTable entries={result.entries} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} entries)
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
