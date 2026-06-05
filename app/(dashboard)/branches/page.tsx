import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { BranchesTable } from "@/features/branches/components/branches-table";
import { listBranchServicePartnersForForm, listBranches, listClientsForBranchForm } from "@/features/branches/services/branch.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { getServicePartnerDisplayLabel } from "@/lib/service-partners/display";

type BranchesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Branch deleted successfully.";
  }
  return undefined;
}

export default async function BranchesPage({ searchParams }: BranchesPageProps) {
  const session = await requirePermission("branches.read");
  const [params, canCreate, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "branches.create"),
    listBranchServicePartnersForForm(session),
  ]);

  const q = getStringParam(params, "q");
  const clientIdParam = getStringParam(params, "clientId");
  const servicePartnerIdParam = getStringParam(params, "servicePartnerId");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const selectedServicePartnerId = session.user.isSuperAdmin
    ? servicePartnerIdParam ?? servicePartners[0]?.id
    : session.user.servicePartnerId;
  const availableClients = await listClientsForBranchForm(session, selectedServicePartnerId);
  const selectedClientId = availableClients.some((client) => client.id === clientIdParam) ? clientIdParam : undefined;
  const result = await listBranches(session, { q, clientId: selectedClientId, page, pageSize });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (session.user.isSuperAdmin && selectedServicePartnerId) {
      next.set("servicePartnerId", selectedServicePartnerId);
    }
    if (selectedClientId) {
      next.set("clientId", selectedClientId);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/branches?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Branches"
        description="Manage branch records mapped to clients and tenants."
        action={canCreate ? { label: "New branch", href: "/branches/new" } : undefined}
      />

      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-4">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by code, name, city, or state"
          className="h-9 rounded-md border border-[var(--border)] px-3 text-sm md:col-span-2"
        />
        {session.user.isSuperAdmin ? (
          <select
            name="servicePartnerId"
            defaultValue={selectedServicePartnerId ?? ""}
            className="h-9 rounded-md border border-[var(--border)] px-3 text-sm"
          >
            {servicePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {getServicePartnerDisplayLabel(partner)}
              </option>
            ))}
          </select>
        ) : null}
        <select
          name="clientId"
          defaultValue={selectedClientId ?? ""}
          className="h-9 rounded-md border border-[var(--border)] px-3 text-sm"
        >
          <option value="">All clients</option>
          {availableClients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name} ({client.code})
            </option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
          Apply
        </button>
      </form>

      {result.branches.length === 0 ? (
        <EmptyState title="No branches found" description="Try changing filters or create a branch for an existing client." />
      ) : (
        <>
          <BranchesTable branches={result.branches} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} branches)
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
