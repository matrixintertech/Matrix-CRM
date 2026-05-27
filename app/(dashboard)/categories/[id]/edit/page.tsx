import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateCategoryAction } from "@/features/categories/actions/category.actions";
import { CategoryForm } from "@/features/categories/components/category-form";
import { getCategoryById, listCategoryServicePartnersForForm } from "@/features/categories/services/category.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditCategoryPageProps = {
  params: Promise<{ id: string }>;
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

export default async function EditCategoryPage({ params, searchParams }: EditCategoryPageProps) {
  const session = await requirePermission("categories.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [category, servicePartners] = await Promise.all([getCategoryById(session, id), listCategoryServicePartnersForForm(session)]);

  if (!category) {
    notFound();
  }

  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Category" description="Update category metadata and tenant mapping." />
      <div>
        <Link href={`/categories/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <CategoryForm
        action={updateCategoryAction.bind(null, id)}
        cancelHref={`/categories/${id}`}
        servicePartners={servicePartners}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        category={{
          servicePartnerId: category.servicePartnerId,
          code: category.code,
          name: category.name,
          description: category.description,
        }}
      />
    </section>
  );
}
