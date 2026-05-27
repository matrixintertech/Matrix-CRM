import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateRateCardAction } from "@/features/rate-cards/actions/rate-card.actions";
import { RateCardForm } from "@/features/rate-cards/components/rate-card-form";
import {
  getRateCardById,
  listClientsForRateCardForm,
  listItemsForRateCardForm,
  listRateCardServicePartnersForForm,
} from "@/features/rate-cards/services/rate-card.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditRateCardPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Rate card code must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Client or item must belong to the selected service partner.";
  }
  return undefined;
}

function toDateInputValue(value: Date | null) {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString().slice(0, 10);
}

export default async function EditRateCardPage({ params, searchParams }: EditRateCardPageProps) {
  const session = await requirePermission("rate_cards.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const rateCard = await getRateCardById(session, id);

  if (!rateCard) {
    notFound();
  }

  const [servicePartners, clients, items] = await Promise.all([
    listRateCardServicePartnersForForm(session),
    listClientsForRateCardForm(session),
    listItemsForRateCardForm(session),
  ]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Rate Card" description="Update rate card attributes and pricing lines." />
      <div>
        <Link href={`/rate-cards/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <RateCardForm
        action={updateRateCardAction.bind(null, id)}
        cancelHref={`/rate-cards/${id}`}
        servicePartners={servicePartners}
        clients={clients}
        items={items}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        rateCard={{
          servicePartnerId: rateCard.servicePartnerId,
          clientId: rateCard.clientId,
          code: rateCard.code,
          name: rateCard.name,
          effectiveFrom: toDateInputValue(rateCard.effectiveFrom) ?? "",
          effectiveTo: toDateInputValue(rateCard.effectiveTo),
          status: rateCard.status,
          lines: rateCard.lines.map((line) => ({
            itemId: line.itemId,
            rate: Number(line.rate).toFixed(2),
            taxPercent: line.taxPercent === null ? undefined : Number(line.taxPercent).toFixed(2),
          })),
        }}
      />
    </section>
  );
}
