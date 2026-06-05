import Link from "next/link";

import { PageHeader } from "@/components/admin/page-header";
import { listActiveStatesWithCities } from "@/features/locations/services/location.service";
import { createServicePartnerAction } from "@/features/service-partners/actions/service-partner.actions";
import { ServicePartnerForm } from "@/features/service-partners/components/service-partner-form";
import { canManageServicePartners } from "@/features/service-partners/services/service-partner.service";
import { redirectForbidden } from "@/lib/auth/access-control";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewServicePartnerPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the form values.";
  }
  if (code === "duplicate") {
    return "Service partner code must be unique.";
  }
  if (code === "location") {
    return "Select a valid state and city combination.";
  }
  return undefined;
}

export default async function NewServicePartnerPage({ searchParams }: NewServicePartnerPageProps) {
  const session = await requirePermission("service_partners.create");
  if (!canManageServicePartners(session)) {
    redirectForbidden("/service-partners");
  }

  const [params, states] = await Promise.all([resolveSearchParams(searchParams), listActiveStatesWithCities()]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Service Partner" description="Create a new tenant service partner." />
      <div>
        <Link href="/service-partners" className="text-sm text-[var(--muted)] underline">
          Back to service partners
        </Link>
      </div>
      <ServicePartnerForm action={createServicePartnerAction} cancelHref="/service-partners" errorMessage={errorMessage} states={states} />
    </section>
  );
}
