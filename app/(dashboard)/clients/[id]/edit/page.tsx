import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateClientAction } from "@/features/clients/actions/client.actions";
import { ClientForm } from "@/features/clients/components/client-form";
import { getClientById, listClientServicePartnersForForm } from "@/features/clients/services/client.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditClientPageProps = {
  params: Promise<{ id: string }>;
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
  return undefined;
}

export default async function EditClientPage({ params, searchParams }: EditClientPageProps) {
  const session = await requirePermission("clients.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [client, servicePartners] = await Promise.all([getClientById(session, id), listClientServicePartnersForForm(session)]);

  if (!client) {
    notFound();
  }

  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Client" description="Update client profile and status." />
      <div>
        <Link href={`/clients/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <ClientForm
        action={updateClientAction.bind(null, id)}
        cancelHref={`/clients/${id}`}
        servicePartners={servicePartners}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        client={{
          servicePartnerId: client.servicePartnerId,
          code: client.code,
          name: client.name,
          legalName: client.legalName,
          email: client.email,
          phone: client.phone,
          address: client.address,
          city: client.city,
          state: client.state,
          country: client.country,
          postalCode: client.postalCode,
          status: client.status,
        }}
      />
    </section>
  );
}
