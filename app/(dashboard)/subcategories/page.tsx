import Link from "next/link";

import { PrefetchLink } from "@/components/admin/prefetch-link";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { listSubcategories } from "@/features/subcategories/services/subcategory.service";

type SubcategoriesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Subcategory created successfully.";
  }
  if (code === "created-all") {
    return "Subcategory created for all service partners.";
  }
  return undefined;
}

export default async function SubcategoriesPage({ searchParams }: SubcategoriesPageProps) {
  const session = await requirePermission("categories.read");
  const [params, canCreate] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "categories.create")]);
  const q = getStringParam(params, "q");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));
  const subcategories = await listSubcategories(session, { q });

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[2rem] font-semibold tracking-[-0.04em] text-[#10244b]">Subcategories</h1>
          <p className="mt-2 text-sm text-[#7082a6]">Manage category buckets between Category and Item.</p>
        </div>
        {canCreate ? (
          <PrefetchLink href="/subcategories/new" className="inline-flex h-11 items-center justify-center rounded-2xl bg-gradient-to-r from-[#575dff] to-[#3267ff] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(50,103,255,0.24)]">
            Add Subcategory
          </PrefetchLink>
        ) : null}
      </div>

      <div>
        <Link href="/items" className="text-sm text-[var(--muted)] underline">
          Back to items
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="rounded-[24px] border border-[#e6ecf7] bg-white p-4 shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <form action="" className="flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search subcategories..."
            className="h-11 flex-1 rounded-2xl border border-[#d8e2f2] bg-[#fbfcff] px-4 text-sm text-[#13305d] outline-none transition focus:border-[#4b6bff] focus:ring-4 focus:ring-[#e3eaff]"
          />
          <button type="submit" className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#d9e3ff] bg-[#f7f9ff] px-5 text-sm font-semibold text-[#315cff]">
            Apply
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-[#e6ecf7] bg-white shadow-[0_16px_40px_rgba(22,48,101,0.05)]">
        <table className="min-w-full text-left">
          <thead className="bg-[#fbfcff] text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7e91b2]">
            <tr>
              <th className="px-5 py-4">Code</th>
              <th className="px-4 py-4">Name</th>
              <th className="px-4 py-4">Category</th>
              <th className="px-4 py-4">Company</th>
              <th className="px-4 py-4">Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#edf2fb]">
            {subcategories.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-sm text-[#7486a8]">
                  No subcategories found.
                </td>
              </tr>
            ) : (
              subcategories.map((subcategory) => (
                <tr key={subcategory.id} className="transition hover:bg-[#fbfcff]">
                  <td className="px-5 py-4 text-sm font-semibold text-[#315cff]">{subcategory.code}</td>
                  <td className="px-4 py-4 text-sm text-[#122449]">{subcategory.name}</td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">
                    {subcategory.category.name} ({subcategory.category.code})
                  </td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">
                    {subcategory.servicePartner.name} ({subcategory.servicePartner.code})
                  </td>
                  <td className="px-4 py-4 text-sm text-[#24406f]">{subcategory._count.items}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
