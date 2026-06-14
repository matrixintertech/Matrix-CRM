import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createCategoryAction } from "@/features/categories/actions/category.actions";
import { CategoryForm } from "@/features/categories/components/category-form";
import { listCategoryServicePartnersForForm } from "@/features/categories/services/category.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewCategoryPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Category code must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  return undefined;
}

export default async function NewCategoryPage({ searchParams }: NewCategoryPageProps) {
  const session = await requirePermission("categories.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listCategoryServicePartnersForForm(session),
  ]);

  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create Category" description="Create a category for a service partner tenant." />
      <div>
        <Link href="/categories" className="text-sm text-[var(--muted)] underline">
          Back to categories
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding categories." />
      ) : (
        <CategoryForm
          action={createCategoryAction}
          cancelHref="/categories"
          servicePartners={servicePartners}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId}
        />
      )}
    </section>
  );
}
