import { PurchaseOrderStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { PurchaseOrdersTable } from "@/features/purchase-orders/components/purchase-orders-table";
import { listPurchaseOrders, listVendorsForPurchaseOrderForm } from "@/features/purchase-orders/services/purchase-order.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type PurchaseOrdersPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  if (code === "not-found") {
    return "Purchase order record could not be found.";
  }
  return undefined;
}

function getSuccessMessage(code?: string) {
  if (code === "deleted") {
    return "Purchase order deleted successfully.";
  }
  return undefined;
}

export default async function PurchaseOrdersPage({ searchParams }: PurchaseOrdersPageProps) {
  const session = await requirePermission("purchase_orders.read");
  const [params, canCreate] = await Promise.all([
    resolveSearchParams(searchParams),
    hasPermission(session, "purchase_orders.create"),
  ]);

  const q = getStringParam(params, "q");
  const statusParam = getStringParam(params, "status");
  const status = Object.values(PurchaseOrderStatus).find((value) => value === statusParam);
  const vendorId = getStringParam(params, "vendorId");
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const successMessage = getSuccessMessage(getStringParam(params, "success"));

  const [result, vendors] = await Promise.all([
    listPurchaseOrders(session, { q, status, vendorId, page, pageSize }),
    listVendorsForPurchaseOrderForm(session),
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
    return `/purchase-orders?${next.toString()}`;
  }

  return (
    <section className="space-y-5">
      <PageHeader
        title="PO List"
        description="Manage purchase orders linked to vendors, RFQs, and service requests."
        action={canCreate ? { label: "New PO", href: "/purchase-orders/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <form className="grid gap-2 rounded-md border border-[var(--border)] bg-white p-3 md:grid-cols-4" action="">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by PO number, vendor, service request"
          className="h-9 min-w-0 rounded-md border border-[var(--border)] px-3 text-sm"
        />
        <select name="status" defaultValue={status ?? ""} className="h-9 rounded-md border border-[var(--border)] px-3 text-sm">
          <option value="">All statuses</option>
          {Object.values(PurchaseOrderStatus).map((statusValue) => (
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
        <div>
          <button type="submit" className="h-9 rounded-md border border-slate-200 px-3 text-sm font-medium">
            Apply
          </button>
        </div>
      </form>

      {result.purchaseOrders.length === 0 ? (
        <EmptyState title="No purchase orders found" description="Try adjusting filters or create a new purchase order." />
      ) : (
        <>
          <PurchaseOrdersTable purchaseOrders={result.purchaseOrders} />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} purchase orders)
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
