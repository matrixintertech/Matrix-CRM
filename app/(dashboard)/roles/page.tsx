import { RoleScope } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SearchFilter } from "@/components/admin/search-filter";
import { RolesTable } from "@/features/rbac/components/roles-table";
import { listRoles } from "@/features/rbac/services/role.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type RolesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const scopeOptions = Object.values(RoleScope).map((scope) => ({ label: scope, value: scope }));

function getErrorMessage(code?: string) {
  if (code === "protected") {
    return "That role is protected and cannot be deleted.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Role deleted successfully.";
  }
  return undefined;
}

export default async function RolesPage({ searchParams }: RolesPageProps) {
  const session = await requirePermission("roles.read");
  const [canCreate, params] = await Promise.all([hasPermission(session, "roles.create"), resolveSearchParams(searchParams)]);

  const q = getStringParam(params, "q");
  const scopeParam = getStringParam(params, "status");
  const scope = Object.values(RoleScope).find((value) => value === scopeParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listRoles(session, { q, scope, page, pageSize });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (scope) {
      next.set("status", scope);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/roles?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Roles"
        description="Create and maintain role definitions and role-level access."
        action={canCreate ? { label: "New role", href: "/roles/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <SearchFilter query={q} status={scope} statusOptions={scopeOptions} placeholder="Search by role name, key, or description" />

      {result.roles.length === 0 ? (
        <EmptyState title="No roles found" description="Try changing filters or create a new tenant role." />
      ) : (
        <>
          <RolesTable roles={result.roles} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} roles)
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
