import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { PageHeader } from "@/components/admin/page-header";
import { deleteCategoryAction } from "@/features/categories/actions/category.actions";
import { getCategoryById } from "@/features/categories/services/category.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type CategoryDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Category created successfully.";
  }
  if (code === "updated") {
    return "Category updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function CategoryDetailPage({ params, searchParams }: CategoryDetailPageProps) {
  const session = await requirePermission("categories.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const category = await getCategoryById(session, id);

  if (!category) {
    notFound();
  }

  const [canUpdate, canDelete] = await Promise.all([
    hasPermission(session, "categories.update"),
    hasPermission(session, "categories.delete"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={category.name}
        description="Review category details and item mapping."
        action={canUpdate ? { label: "Edit category", href: `/categories/${category.id}/edit` } : undefined}
      />
      <div>
        <Link href="/categories" className="text-sm text-[var(--muted)] underline">
          Back to categories
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="crm-panel">
          <h2 className="mb-4 text-base font-semibold">Summary</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Code</dt>
              <dd>{category.code}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Name</dt>
              <dd>{category.name}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-[var(--muted)]">Description</dt>
              <dd>{formatOptional(category.description)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Service partner</dt>
              <dd>
                {category.servicePartner.name} ({category.servicePartner.code})
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Items</dt>
              <dd>{category._count.items}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Created</dt>
              <dd>{formatDateTime(category.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Updated</dt>
              <dd>{formatDateTime(category.updatedAt)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-[var(--muted)]">
            Related items:{" "}
            <Link href={`/items?categoryId=${category.id}`} className="underline">
              View filtered items
            </Link>
          </p>
        </div>

        {canDelete ? (
          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Danger zone</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">This will soft-delete the category and hide it from listings.</p>
            <ConfirmAction
              action={deleteCategoryAction.bind(null, category.id)}
              label="Delete category"
              intent="danger"
              fields={{ redirectTo: "/categories" }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
