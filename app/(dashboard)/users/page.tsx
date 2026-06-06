import { UserStatus } from "@prisma/client";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { PrefetchLink } from "@/components/admin/prefetch-link";
import { SearchFilter } from "@/components/admin/search-filter";
import { UsersTable } from "@/features/users/components/users-table";
import { listUsers } from "@/features/users/services/user.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type UsersPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const statusOptions = Object.values(UserStatus).map((status) => ({ label: status, value: status }));

function getErrorMessage(code?: string) {
  if (code === "forbidden") {
    return "You do not have access to this user.";
  }
  if (code === "validation") {
    return "Please review the submitted data.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "User deleted successfully.";
  }
  return undefined;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const session = await requirePermission("users.read");
  const [canCreate, params] = await Promise.all([hasPermission(session, "users.create"), resolveSearchParams(searchParams)]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(UserStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listUsers(session, { q, status, page, pageSize });

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
    return `/users?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Users"
        description="Manage tenant and platform users, statuses, and role-based access."
        action={canCreate ? { label: "New user", href: "/users/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <SearchFilter query={q} status={status} statusOptions={statusOptions} placeholder="Search by name, email, or phone" />

      {result.users.length === 0 ? (
        <EmptyState title="No users found" description="Try changing filters or create the first user for this tenant." />
      ) : (
        <>
          <UsersTable users={result.users} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} users)
            </p>
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <PrefetchLink href={buildPageHref(result.page - 1)} className="rounded-md border border-slate-200 px-3 py-2">
                  Previous
                </PrefetchLink>
              ) : null}
              {result.page < result.totalPages ? (
                <PrefetchLink href={buildPageHref(result.page + 1)} className="rounded-md border border-slate-200 px-3 py-2">
                  Next
                </PrefetchLink>
              ) : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
