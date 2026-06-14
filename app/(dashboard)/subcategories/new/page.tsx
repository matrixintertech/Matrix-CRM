import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createSubcategoryAction } from "@/features/subcategories/actions/subcategory.actions";
import { SubcategoryForm } from "@/features/subcategories/components/subcategory-form";
import {
  listCategoriesForSubcategoryForm,
  listSubcategoryServicePartnersForForm,
} from "@/features/subcategories/services/subcategory.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewSubcategoryPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Subcategory code must be unique within the selected category and service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "mismatch") {
    return "Category must belong to the selected service partner.";
  }
  return undefined;
}

export default async function NewSubcategoryPage({ searchParams }: NewSubcategoryPageProps) {
  const session = await requirePermission("categories.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listSubcategoryServicePartnersForForm(session),
  ]);

  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;
  const requestedCategoryId = getStringParam(params, "categoryId");
  const categories = await listCategoriesForSubcategoryForm(session);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Subcategory" description="Create a subcategory under an existing category." />
      <div>
        <Link href="/subcategories" className="text-sm text-[var(--muted)] underline">
          Back to subcategories
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding subcategories." />
      ) : categories.length === 0 ? (
        <EmptyState title="No categories found" description="Create categories before adding subcategories." />
      ) : (
        <SubcategoryForm
          action={createSubcategoryAction}
          cancelHref="/subcategories"
          servicePartners={servicePartners}
          categories={categories}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
          defaultCategoryId={requestedCategoryId}
        />
      )}
    </section>
  );
}
