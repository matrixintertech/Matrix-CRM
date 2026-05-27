import { ClientStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SearchFilter } from "@/components/admin/search-filter";
import { ClientsTable } from "@/features/clients/components/clients-table";
import { listClients } from "@/features/clients/services/client.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ClientsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const statusOptions = Object.values(ClientStatus).map((status) => ({ label: status, value: status }));

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Client deleted successfully.";
  }
  return undefined;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const session = await requirePermission("clients.read");
  const [params, canCreate] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "clients.create")]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(ClientStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listClients(session, { q, status, page, pageSize });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (status) {
      next.set("status", status);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/clients?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Clients"
        description="Manage client masters per tenant and branch relationships."
        action={canCreate ? { label: "New client", href: "/clients/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <SearchFilter query={q} status={status} statusOptions={statusOptions} placeholder="Search by code, name, email, or phone" />

      {result.clients.length === 0 ? (
        <EmptyState title="No clients found" description="Try adjusting filters or create a new client." />
      ) : (
        <>
          <ClientsTable clients={result.clients} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} clients)
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
