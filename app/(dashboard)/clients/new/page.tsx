import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createClientAction } from "@/features/clients/actions/client.actions";
import { ClientForm } from "@/features/clients/components/client-form";
import { listClientServicePartnersForForm } from "@/features/clients/services/client.service";
import { listActiveStatesWithCities } from "@/features/locations/services/location.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewClientPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Client code must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "location") {
    return "Select a valid state and city combination.";
  }
  return undefined;
}

export default async function NewClientPage({ searchParams }: NewClientPageProps) {
  const session = await requirePermission("clients.create");
  const [params, servicePartners, states] = await Promise.all([
    resolveSearchParams(searchParams),
    listClientServicePartnersForForm(session),
    listActiveStatesWithCities(),
  ]);

  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Client" description="Create a tenant-scoped client record." />
      <div>
        <Link href="/clients" className="text-sm text-[var(--muted)] underline">
          Back to clients
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding clients." />
      ) : (
        <ClientForm
          action={createClientAction}
          cancelHref="/clients"
          servicePartners={servicePartners}
          states={states}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
        />
      )}
    </section>
  );
}
