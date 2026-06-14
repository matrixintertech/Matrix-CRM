import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateItemAction } from "@/features/items/actions/item.actions";
import { ItemForm } from "@/features/items/components/item-form";
import {
  getItemById,
  listCategoriesForItemForm,
  listItemServicePartnersForForm,
  listSubcategoriesForItemForm,
  listUomsForItemForm,
} from "@/features/items/services/item.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditItemPageProps = {
  params: Promise<{ id: string }>;
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

export default async function EditItemPage({ params, searchParams }: EditItemPageProps) {
  const session = await requirePermission("items.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const item = await getItemById(session, id);

  if (!item) {
    notFound();
  }

  const [servicePartners, categories, subcategories, uoms] = await Promise.all([
    listItemServicePartnersForForm(session),
    listCategoriesForItemForm(session),
    listSubcategoriesForItemForm(session),
    listUomsForItemForm(session),
  ]);
  const requestedServicePartnerId = getStringParam(paramsValue, "servicePartnerId");
  const requestedCategoryId = getStringParam(paramsValue, "categoryId");
  const requestedSubcategoryId = getStringParam(paramsValue, "subcategoryId");
  const requestedUomId = getStringParam(paramsValue, "uomId");
  const requestedUomCode = getStringParam(paramsValue, "uomCode");
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Item" description="Update item details, category, and status." />
      <div>
        <Link href={`/items/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <ItemForm
        action={updateItemAction.bind(null, id)}
        cancelHref={`/items/${id}`}
        returnToPath={`/items/${id}/edit`}
        servicePartners={servicePartners}
        categories={categories}
        subcategories={subcategories}
        uoms={uoms}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        defaultServicePartnerId={requestedServicePartnerId ?? item.servicePartnerId}
        defaultCategoryId={requestedCategoryId}
        defaultSubcategoryId={requestedSubcategoryId}
        defaultUomId={requestedUomId}
        defaultUomCode={requestedUomCode}
        item={{
          servicePartnerId: item.servicePartnerId,
          categoryId: item.categoryId,
          subcategoryId: item.subcategoryId,
          uomId: item.uomId,
          code: item.code,
          name: item.name,
          unit: item.unit,
          description: item.description,
          active: item.active,
        }}
      />
    </section>
  );
}
