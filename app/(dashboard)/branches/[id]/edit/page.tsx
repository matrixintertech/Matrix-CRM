import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { updateBranchAction } from "@/features/branches/actions/branch.actions";
import { BranchForm } from "@/features/branches/components/branch-form";
import { getBranchById, listBranchServicePartnersForForm, listClientsForBranchForm } from "@/features/branches/services/branch.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type EditBranchPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please provide valid branch details.";
  }
  if (code === "duplicate") {
    return "Branch code must be unique within the selected client.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Selected client does not belong to the selected service partner.";
  }
  return undefined;
}

export default async function EditBranchPage({ params, searchParams }: EditBranchPageProps) {
  const session = await requirePermission("branches.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const branch = await getBranchById(session, id);

  if (!branch) {
    notFound();
  }

  const servicePartners = await listBranchServicePartnersForForm(session);
  const selectedServicePartnerId = session.user.isSuperAdmin
    ? getStringParam(paramsValue, "servicePartnerId") ?? branch.servicePartnerId
    : branch.servicePartnerId;
  const clients = await listClientsForBranchForm(session, selectedServicePartnerId);
  const selectedClientId = clients.some((client) => client.id === branch.clientId) ? branch.clientId : clients[0]?.id;
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Branch" description="Update branch details and client mapping." />
      <div>
        <Link href={`/branches/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>

      {session.user.isSuperAdmin ? (
        <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-[1fr_auto]">
          <input type="hidden" name="id" value={id} />
          <select
            name="servicePartnerId"
            defaultValue={selectedServicePartnerId}
            className="h-9 rounded-md border border-[var(--border)] px-3 text-sm"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
            Load clients
          </button>
        </form>
      ) : null}

      {clients.length === 0 ? (
        <EmptyState title="No client available" description="Create a client for this service partner before updating this branch." />
      ) : (
        <BranchForm
          action={updateBranchAction.bind(null, id)}
          cancelHref={`/branches/${id}`}
          servicePartners={servicePartners}
          clients={clients}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          branch={{
            servicePartnerId: selectedServicePartnerId,
            clientId: selectedClientId ?? branch.clientId,
            code: branch.code,
            name: branch.name,
            address: branch.address,
            city: branch.city,
            state: branch.state,
            country: branch.country,
            postalCode: branch.postalCode,
          }}
        />
      )}
    </section>
  );
}
