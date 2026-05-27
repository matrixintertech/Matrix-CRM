import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createBranchAction } from "@/features/branches/actions/branch.actions";
import { BranchForm } from "@/features/branches/components/branch-form";
import { listBranchServicePartnersForForm, listClientsForBranchForm } from "@/features/branches/services/branch.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewBranchPageProps = {
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

export default async function NewBranchPage({ searchParams }: NewBranchPageProps) {
  const session = await requirePermission("branches.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listBranchServicePartnersForForm(session),
  ]);

  const selectedServicePartnerId = session.user.isSuperAdmin
    ? getStringParam(params, "servicePartnerId") ?? servicePartners[0]?.id
    : session.user.servicePartnerId;
  const clients = await listClientsForBranchForm(session, selectedServicePartnerId);
  const selectedClientIdParam = getStringParam(params, "clientId");
  const selectedClientId = clients.some((client) => client.id === selectedClientIdParam)
    ? selectedClientIdParam
    : clients[0]?.id;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Branch" description="Create a branch and map it to a client in the same tenant." />
      <div>
        <Link href="/branches" className="text-sm text-[var(--muted)] underline">
          Back to branches
        </Link>
      </div>

      {session.user.isSuperAdmin ? (
        <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-[1fr_auto]">
          <select
            name="servicePartnerId"
            defaultValue={selectedServicePartnerId ?? ""}
            className="h-9 rounded-md border border-[var(--border)] px-3 text-sm"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name} ({partner.code})
              </option>
            ))}
          </select>
          <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
            Load clients
          </button>
        </form>
      ) : null}

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create a service partner before adding branches." />
      ) : clients.length === 0 ? (
        <EmptyState title="No client found" description="Create a client for this service partner before adding branches." />
      ) : (
        <BranchForm
          action={createBranchAction}
          cancelHref="/branches"
          servicePartners={servicePartners}
          clients={clients}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={selectedServicePartnerId}
          defaultClientId={selectedClientId}
        />
      )}
    </section>
  );
}
