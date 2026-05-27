import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createRateCardAction } from "@/features/rate-cards/actions/rate-card.actions";
import { RateCardForm } from "@/features/rate-cards/components/rate-card-form";
import {
  listClientsForRateCardForm,
  listItemsForRateCardForm,
  listRateCardServicePartnersForForm,
} from "@/features/rate-cards/services/rate-card.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewRateCardPageProps = {
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

export default async function NewRateCardPage({ searchParams }: NewRateCardPageProps) {
  const session = await requirePermission("rate_cards.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listRateCardServicePartnersForForm(session),
  ]);

  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;
  const [clients, items] = await Promise.all([
    listClientsForRateCardForm(session, defaultServicePartnerId),
    listItemsForRateCardForm(session, defaultServicePartnerId),
  ]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Rate Card" description="Create a general or client-specific rate card with item lines." />
      <div>
        <Link href="/rate-cards" className="text-sm text-[var(--muted)] underline">
          Back to rate cards
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding rate cards." />
      ) : items.length === 0 ? (
        <EmptyState title="No items found" description="Create at least one item before adding rate card lines." />
      ) : (
        <RateCardForm
          action={createRateCardAction}
          cancelHref="/rate-cards"
          servicePartners={servicePartners}
          clients={clients}
          items={items}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}

