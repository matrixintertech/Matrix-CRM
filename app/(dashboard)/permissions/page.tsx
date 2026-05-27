import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SearchFilter } from "@/components/admin/search-filter";
import { PermissionsTable } from "@/features/rbac/components/permissions-table";
import { listPermissions } from "@/features/rbac/services/permission.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type PermissionsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

export default async function PermissionsPage({ searchParams }: PermissionsPageProps) {
  const session = await requirePermission("permissions.read");
  const params = await resolveSearchParams(searchParams);

  const q = getStringParam(params, "q");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");

  const result = await listPermissions(session, { q, page, pageSize });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/permissions?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader title="Permissions" description="Read-only permission catalog seeded by the platform." />
      <SearchFilter query={q} placeholder="Search by key, module, or action" />

      {result.permissions.length === 0 ? (
        <EmptyState title="No permissions found" description="Run seed if the permission catalog is empty." />
      ) : (
        <>
          <PermissionsTable permissions={result.permissions} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} permissions)
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
