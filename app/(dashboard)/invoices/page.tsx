import { InvoiceStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { ExportActions } from "@/components/admin/export-actions";
import { PageHeader } from "@/components/admin/page-header";
import { InvoicesTable } from "@/features/invoices/components/invoices-table";
import { listInvoices, listVendorsForInvoiceForm } from "@/features/invoices/services/invoice.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type InvoicesPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  if (code === "not-found") {
    return "Vendor invoice record could not be found.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Vendor invoice deleted successfully.";
  }
  return undefined;
}

export default async function InvoicesPage({ searchParams }: InvoicesPageProps) {
  const session = await requirePermission("invoices.read");
  const [params, canCreate, canExport] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "invoices.create"),
    hasPermission(session, "invoices.export"),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(InvoiceStatus).find((value) => value === statusParam);
  const vendorId = getStringParam(params, "vendorId");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, vendors] = await Promise.all([
    listInvoices(session, { q, status, vendorId, page, pageSize }),
    listVendorsForInvoiceForm(session),
  ]);

  function buildPageHref(nextPage: number) {
    const next = new URLSearchParams();
    if (q) {
      next.set("q", q);
    }
    if (status) {
      next.set("status", status);
    }
    if (vendorId) {
      next.set("vendorId", vendorId);
    }
    if (result.pageSize !== 20) {
      next.set("pageSize", String(result.pageSize));
    }
    next.set("page", String(nextPage));
    return `/invoices?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="Vendor Invoices"
        description="Manage received vendor invoices linked to vendors, purchase orders, and service requests."
        action={canCreate ? { label: "Record Vendor Invoice", href: "/invoices/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-4" action="">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by vendor invoice no., internal record no., vendor, PO, or service request"
          className="h-9 min-w-0 rounded-md border border-[var(--border)] px-3 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border border-[var(--border)] px-3 text-sm">
          <option value="">All statuses</option>
          {Object.values(InvoiceStatus).map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {statusValue}
            </option>
          ))}
        </select>
        <select name="vendorId" defaultValue={vendorId ?? ""} className="h-9 rounded-md border border-[var(--border)] px-3 text-sm">
          <option value="">All vendors</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name} ({vendor.code})
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
            Apply
          </button>
          {canExport ? <ExportActions moduleKey="invoices" query={{ q, status, vendorId }} /> : null}
        </div>
      </form>

      {result.invoices.length === 0 ? (
        <EmptyState title="No vendor invoices found" description="No vendor invoices recorded yet." />
      ) : (
        <>
          <InvoicesTable invoices={result.invoices} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} vendor invoices)
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
