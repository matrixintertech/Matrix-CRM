import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SearchFilter } from "@/components/admin/search-filter";
import { CategoriesTable } from "@/features/categories/components/categories-table";
import { listCategories } from "@/features/categories/services/category.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type CategoriesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Category deleted successfully.";
  }
  return undefined;
}

export default async function CategoriesPage({ searchParams }: CategoriesPageProps) {
  const session = await requirePermission("categories.read");
  const [params, canCreate] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "categories.create")]);

  const q = getStringParam(params, "q");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listCategories(session, { q, page, pageSize });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/categories?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Categories"
        description="Manage tenant-specific service categories."
        action={canCreate ? { label: "New category", href: "/categories/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <SearchFilter query={q} placeholder="Search by code or name" />

      {result.categories.length === 0 ? (
        <EmptyState title="No categories found" description="Try adjusting filters or create a new category." />
      ) : (
        <>
          <CategoriesTable categories={result.categories} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} categories)
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
