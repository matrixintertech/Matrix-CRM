import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createItemAction } from "@/features/items/actions/item.actions";
import { ItemForm } from "@/features/items/components/item-form";
import {
  listCategoriesForItemForm,
  listItemServicePartnersForForm,
  listSubcategoriesForItemForm,
  listUomsForItemForm,
} from "@/features/items/services/item.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewItemPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Item code must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Category, subcategory, and UOM must belong to the selected service partner.";
  }
  return undefined;
}

export default async function NewItemPage({ searchParams }: NewItemPageProps) {
  const session = await requirePermission("items.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listItemServicePartnersForForm(session),
  ]);

  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const requestedCategoryId = getStringParam(params, "categoryId");
  const requestedSubcategoryId = getStringParam(params, "subcategoryId");
  const requestedUomId = getStringParam(params, "uomId");
  const requestedUomCode = getStringParam(params, "uomCode");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;
  const [categories, subcategories, uoms] = await Promise.all([
    listCategoriesForItemForm(session),
    listSubcategoriesForItemForm(session),
    listUomsForItemForm(session),
  ]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const returnToParams = new URLSearchParams();

  if (requestedServicePartnerId) {
    returnToParams.set("servicePartnerId", requestedServicePartnerId);
  }
  if (requestedCategoryId) {
    returnToParams.set("categoryId", requestedCategoryId);
  }
  if (requestedSubcategoryId) {
    returnToParams.set("subcategoryId", requestedSubcategoryId);
  }

  const returnToHref = returnToParams.toString() ? `/items/new?${returnToParams.toString()}` : "/items/new";
  const createUomParams = new URLSearchParams();

  if (requestedServicePartnerId) {
    createUomParams.set("servicePartnerId", requestedServicePartnerId);
  }
  createUomParams.set("redirectTo", returnToHref);

  const createUomHref = `/uoms/new?${createUomParams.toString()}`;

  return (
    <section className="space-y-5">
      <PageHeader title="Create Item" description="Create an item and map it to a category." />
      <div>
        <Link href="/items" className="text-sm text-[var(--muted)] underline">
          Back to items
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding items." />
      ) : categories.length === 0 ? (
        <EmptyState title="No categories found" description="Create at least one category before adding items." />
      ) : subcategories.length === 0 ? (
        <EmptyState title="No subcategories found" description="Create at least one subcategory before adding items." />
      ) : uoms.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title="No UOMs found" description="Create at least one unit before adding items." />
          <Link
            href={createUomHref}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)]"
          >
            Create unit
          </Link>
        </div>
      ) : (
        <ItemForm
          action={createItemAction}
          cancelHref="/items"
          returnToPath="/items/new"
          servicePartners={servicePartners}
          categories={categories}
          subcategories={subcategories}
          uoms={uoms}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
          defaultCategoryId={requestedCategoryId}
          defaultSubcategoryId={requestedSubcategoryId}
          defaultUomId={requestedUomId}
          defaultUomCode={requestedUomCode}
        />
      )}
    </section>
  );
}
