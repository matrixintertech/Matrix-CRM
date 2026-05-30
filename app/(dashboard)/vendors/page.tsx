import { VendorStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { VendorsTable } from "@/features/vendors/components/vendors-table";
import { listVendors } from "@/features/vendors/services/vendor.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type VendorsPageProps = {
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
    return "Vendor deleted successfully.";
  }
  return undefined;
}

export default async function VendorsPage({ searchParams }: VendorsPageProps) {
  const session = await requirePermission("vendors.read");
  const [params, canCreate] = await Promise.all([resolveSearchParams(searchParams), hasPermission(session, "vendors.create")]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(VendorStatus).find((value) => value === statusParam);
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const result = await listVendors(session, { q, status, page, pageSize });

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (status) {
      next.set("status", status);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/vendors?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Supplier Management"
        description="Manage vendor master records for procurement workflows."
        action={canCreate ? { label: "New vendor", href: "/vendors/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-4" action="">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by code, name, email, phone, GST"
          className="h-9 min-w-0 rounded-md border border-[var(--border)] px-3 text-sm md:col-span-2"
        />
        <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border border-[var(--border)] px-3 text-sm">
          <option value="">All statuses</option>
          {Object.values(VendorStatus).map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {statusValue}
            </option>
          ))}
        </select>
        <div>
          <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
            Apply
          </button>
        </div>
      </form>

      {result.vendors.length === 0 ? (
        <EmptyState title="No vendors found" description="Try adjusting filters or create a new vendor." />
      ) : (
        <>
          <VendorsTable vendors={result.vendors} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} vendors)
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
