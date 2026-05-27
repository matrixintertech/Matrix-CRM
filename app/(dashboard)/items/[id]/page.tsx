import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { ItemStatusActions } from "@/features/items/components/item-status-actions";
import { getItemById } from "@/features/items/services/item.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ItemDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Item created successfully.";
  }
  if (code === "updated") {
    return "Item updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function ItemDetailPage({ params, searchParams }: ItemDetailPageProps) {
  const session = await requirePermission("items.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const item = await getItemById(session, id);

  if (!item) {
    notFound();
  }

  const [canUpdate, canDelete] = await Promise.all([
    hasPermission(session, "items.update"),
    hasPermission(session, "items.delete"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={item.name}
        description="Review item details, category mapping, and status."
        action={canUpdate ? { label: "Edit item", href: `/items/${item.id}/edit` } : undefined}
      />
      <div>
        <Link href="/items" className="text-sm text-[var(--muted)] underline">
          Back to items
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <h2 className="mb-4 text-base font-semibold">Summary</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Code</dt>
              <dd>{item.code}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Status</dt>
              <dd>
                <StatusBadge value={item.active ? "ACTIVE" : "INACTIVE"} />
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Unit</dt>
              <dd>{item.unit}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Category</dt>
              <dd>
                <Link href={`/categories/${item.category.id}`} className="underline">
                  {item.category.name} ({item.category.code})
                </Link>
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-[var(--muted)]">Description</dt>
              <dd>{formatOptional(item.description)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Service partner</dt>
              <dd>
                {item.servicePartner.name} ({item.servicePartner.code})
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Rate card lines</dt>
              <dd>{item._count.rateCardLines}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Created</dt>
              <dd>{formatDateTime(item.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Updated</dt>
              <dd>{formatDateTime(item.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        {canUpdate ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
            <ItemStatusActions itemId={item.id} canDelete={canDelete} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

