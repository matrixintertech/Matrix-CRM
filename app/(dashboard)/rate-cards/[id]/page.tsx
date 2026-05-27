import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { RateCardStatusActions } from "@/features/rate-cards/components/rate-card-status-actions";
import { getRateCardById } from "@/features/rate-cards/services/rate-card.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime } from "@/lib/utils/format";

type RateCardDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Rate card created successfully.";
  }
  if (code === "updated") {
    return "Rate card updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function RateCardDetailPage({ params, searchParams }: RateCardDetailPageProps) {
  const session = await requirePermission("rate_cards.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const rateCard = await getRateCardById(session, id);

  if (!rateCard) {
    notFound();
  }

  const [canUpdate, canDelete, canPublish] = await Promise.all([
    hasPermission(session, "rate_cards.update"),
    hasPermission(session, "rate_cards.delete"),
    hasPermission(session, "rate_cards.publish"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={rateCard.name}
        description="Review rate card details, effective window, and line rates."
        action={canUpdate ? { label: "Edit rate card", href: `/rate-cards/${rateCard.id}/edit` } : undefined}
      />
      <div>
        <Link href="/rate-cards" className="text-sm text-[var(--muted)] underline">
          Back to rate cards
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Code</dt>
                <dd>{rateCard.code}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={rateCard.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service partner</dt>
                <dd>
                  {rateCard.servicePartner.name} ({rateCard.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Client</dt>
                <dd>{rateCard.client ? `${rateCard.client.name} (${rateCard.client.code})` : "General"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Effective from</dt>
                <dd>{formatDateTime(rateCard.effectiveFrom)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Effective to</dt>
                <dd>{rateCard.effectiveTo ? formatDateTime(rateCard.effectiveTo) : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Total lines</dt>
                <dd>{rateCard._count.lines}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(rateCard.createdAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Lines</h2>
            {rateCard.lines.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No lines configured.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Rate</th>
                      <th className="px-3 py-2">Tax %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rateCard.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          {line.item.name} ({line.item.code})
                        </td>
                        <td className="px-3 py-2">{line.item.unit}</td>
                        <td className="px-3 py-2">{Number(line.rate).toFixed(2)}</td>
                        <td className="px-3 py-2">{line.taxPercent === null ? "-" : Number(line.taxPercent).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {canUpdate ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
            <RateCardStatusActions rateCardId={rateCard.id} canDelete={canDelete} canPublish={canPublish} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
