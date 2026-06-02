import { PaymentStatus } from "@prisma/client";
import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { SearchFilter } from "@/components/admin/search-filter";
import { VendorPaymentSummaryCard } from "@/features/vendor-payments/components/vendor-payment-summary-card";
import { VendorPaymentsTable } from "@/features/vendor-payments/components/vendor-payments-table";
import { listVendorPayments } from "@/features/vendor-payments/services/vendor-payment.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getNumberParam, getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type VendorPaymentsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

const statusOptions = Object.values(PaymentStatus).map((status) => ({
  label: status,
  value: status,
}));

function getSuccessMessage(code?: string) {
  if (code === "vendor-payment-recorded") {
    return "Vendor payment recorded successfully.";
  }
  if (code === "vendor-payment-updated") {
    return "Vendor payment updated successfully.";
  }
  if (code === "vendor-payment-status-updated") {
    return "Vendor payment status updated successfully.";
  }
  if (code === "vendor-payment-deleted") {
    return "Vendor payment voided successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "vendor-payment-validation") {
    return "Vendor payment validation failed.";
  }
  if (code === "vendor-payment-status-validation") {
    return "Vendor payment status validation failed.";
  }
  if (code === "vendor-payment-duplicate") {
    return "Duplicate vendor payment number detected.";
  }
  if (code === "vendor-payment-mismatch") {
    return "Vendor payment action blocked by tenant scope mismatch.";
  }
  return undefined;
}

export default async function VendorPaymentsPage({ searchParams }: VendorPaymentsPageProps) {
  const session = await requirePermission("vendor_payments.read");
  const params = await resolveSearchParams(searchParams);
  const q = getStringParam(params, "q");
  const status = Object.values(PaymentStatus).find((value) => value === getStringParam(params, "status"));
  const page = getNumberParam(params, "page");
  const pageSize = getNumberParam(params, "pageSize");

  const [canCreate, canUpdate, canDelete, canStatusUpdate, result] = await Promise.all([
    hasPermission(session, "vendor_payments.create"),
    hasPermission(session, "vendor_payments.update"),
    hasPermission(session, "vendor_payments.delete"),
    hasPermission(session, "vendor_payments.status.update"),
    listVendorPayments(session, { q, status, page, pageSize }),
  ]);

  const successMessage = getSuccessMessage(getStringParam(params, "success"));
  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title="Vendor Payments"
        description="Track tenant-scoped vendor disbursements, status, and ledger postings."
        action={canCreate ? { label: "Record Vendor Payment", href: "/vendor-payments/new" } : undefined}
      />

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <VendorPaymentSummaryCard
        count={result.summary.count}
        totalAmount={result.summary.totalAmount}
        settledAmount={result.summary.settledAmount}
        cancelledAmount={result.summary.cancelledAmount}
      />

      <SearchFilter
        query={q}
        status={status}
        statusOptions={statusOptions}
        placeholder="Search by payment number, vendor, PO, or notes"
      />

      {result.vendorPayments.length === 0 ? (
        <EmptyState title="No vendor payments found" description="Record a vendor payment or adjust the applied filters." />
      ) : (
        <>
          <VendorPaymentsTable
            vendorPayments={result.vendorPayments}
            redirectTo="/vendor-payments"
            canUpdate={canUpdate}
            canDelete={canDelete}
            canStatusUpdate={canStatusUpdate}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-[var(--muted)]">
              Page {result.page} of {result.totalPages} ({result.total} vendor payments)
            </p>
            <div className="flex items-center gap-2">
              {result.page > 1 ? (
                <Link href={`/vendor-payments?q=${encodeURIComponent(q ?? "")}&status=${status ?? ""}&page=${result.page - 1}`} className="rounded-md border border-slate-200 px-3 py-2">
                  Previous
                </Link>
              ) : null}
              {result.page < result.totalPages ? (
                <Link href={`/vendor-payments?q=${encodeURIComponent(q ?? "")}&status=${status ?? ""}&page=${result.page + 1}`} className="rounded-md border border-slate-200 px-3 py-2">
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
