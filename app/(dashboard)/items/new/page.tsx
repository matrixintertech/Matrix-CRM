import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createItemAction } from "@/features/items/actions/item.actions";
import { ItemForm } from "@/features/items/components/item-form";
import { listCategoriesForItemForm, listItemServicePartnersForForm } from "@/features/items/services/item.service";
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
    return "Category must belong to the selected service partner.";
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
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;
  const categories = await listCategoriesForItemForm(session, defaultServicePartnerId);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

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
      ) : (
        <ItemForm
          action={createItemAction}
          cancelHref="/items"
          servicePartners={servicePartners}
          categories={categories}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}

