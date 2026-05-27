import { ServicePartnerStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SearchFilter } from "@/components/admin/search-filter";
import { ServicePartnersTable } from "@/features/service-partners/components/service-partners-table";
import { canManageServicePartners, listServicePartners } from "@/features/service-partners/services/service-partner.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type ServicePartnersPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const statusOptions = Object.values(ServicePartnerStatus).map((status) => ({ label: status, value: status }));

function getErrorMessage(code?: string) {
  if (code === "platform-protected") {
    return "The platform service partner cannot be deactivated or deleted.";
  }
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Service partner deleted successfully.";
  }
  return undefined;
}

export default async function ServicePartnersPage({ searchParams }: ServicePartnersPageProps) {
  const session = await requirePermission("service_partners.read");
  const [params, canCreate] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "service_partners.create"),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(ServicePartnerStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listServicePartners(session, { q, status, page, pageSize });
  const canManage = canManageServicePartners(session);

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
    return `/service-partners?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Service Partners"
        description="Manage tenants, contacts, and platform service partner configuration."
        action={canCreate && canManage ? { label: "New service partner", href: "/service-partners/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <SearchFilter query={q} status={status} statusOptions={statusOptions} placeholder="Search by code, name, email, or phone" />

      {result.servicePartners.length === 0 ? (
        <EmptyState title="No service partners found" description="Adjust filters or create a service partner." />
      ) : (
        <>
          <ServicePartnersTable servicePartners={result.servicePartners} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} service partners)
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
