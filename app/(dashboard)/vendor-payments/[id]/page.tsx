import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { VendorPaymentSummaryCard } from "@/features/vendor-payments/components/vendor-payment-summary-card";
import { VendorPaymentStatusActions } from "@/features/vendor-payments/components/vendor-payment-status-actions";
import { getVendorPaymentById } from "@/features/vendor-payments/services/vendor-payment.service";
import { deleteVendorPaymentAction } from "@/features/vendor-payments/actions/vendor-payment.actions";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr, formatDateTime, formatOptional } from "@/lib/utils/format";

type VendorPaymentDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

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
  if (code === "vendor-payment-mismatch") {
    return "Vendor payment action blocked by tenant scope mismatch.";
  }
  return undefined;
}

function getLedgerStatus(
  entries: Array<{
    debitAmount: unknown;
    creditAmount: unknown;
  }>
) {
  if (entries.length === 0) {
    return "Not Posted";
  }

  const net = entries.reduce((sum, entry) => sum + Number(entry.debitAmount) - Number(entry.creditAmount), 0);
  return Math.abs(net) < 0.00001 ? "Reversed" : "Posted";
}

export default async function VendorPaymentDetailPage({ params, searchParams }: VendorPaymentDetailPageProps) {
  const session = await requirePermission("vendor_payments.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const vendorPayment = await getVendorPaymentById(session, id);

  if (!vendorPayment) {
    notFound();
  }

  const [canUpdate, canDelete, canStatusUpdate] = await Promise.all([
    hasPermission(session, "vendor_payments.update"),
    hasPermission(session, "vendor_payments.delete"),
    hasPermission(session, "vendor_payments.status.update"),
  ]);

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));
  const settledAmount = [vendorPayment.status].some((status) => ["APPROVED", "PAID", "PARTIALLY_PAID"].includes(status))
    ? Number(vendorPayment.amount)
    : 0;
  const cancelledAmount = vendorPayment.status === "CANCELLED" ? Number(vendorPayment.amount) : 0;
  const ledgerStatus = getLedgerStatus(vendorPayment.ledgerEntries);

  return (
    <section className="crm-page">
      <PageHeader
        title={vendorPayment.paymentNumber}
        description="Review vendor payment details, linked purchase order, and ledger postings."
        action={canUpdate ? { label: "Edit Vendor Payment", href: `/vendor-payments/${vendorPayment.id}/edit` } : undefined}
      />
      <div>
        <Link href="/vendor-payments" className="crm-back-link">
          Back to vendor payments
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <VendorPaymentSummaryCard
        count={1}
        totalAmount={vendorPayment.amount}
        settledAmount={settledAmount}
        cancelledAmount={cancelledAmount}
      />

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Payment Number</dt>
                <dd>{vendorPayment.paymentNumber}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={vendorPayment.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Partner</dt>
                <dd>
                  {vendorPayment.servicePartner.name} ({vendorPayment.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Vendor</dt>
                <dd>
                  {vendorPayment.vendor.name} ({vendorPayment.vendor.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Purchase Order</dt>
                <dd>
                  {vendorPayment.purchaseOrder ? (
                    <Link href={`/purchase-orders/${vendorPayment.purchaseOrder.id}`} className="text-[var(--primary)] underline">
                      {vendorPayment.purchaseOrder.poNumber}
                    </Link>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Request</dt>
                <dd>
                  {vendorPayment.serviceRequest ? (
                    <Link href={`/service-requests/${vendorPayment.serviceRequest.id}`} className="text-[var(--primary)] underline">
                      {vendorPayment.serviceRequest.serviceNumber}
                    </Link>
                  ) : (
                    "-"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Payment Date</dt>
                <dd>{formatDateTime(vendorPayment.paidAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Amount</dt>
                <dd>{formatCurrencyInr(vendorPayment.amount)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Ledger Status</dt>
                <dd>{ledgerStatus}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Approved Amount</dt>
                <dd>{formatCurrencyInr(vendorPayment.approvedAmount)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Requested By</dt>
                <dd>{vendorPayment.requestedBy?.name?.trim() || vendorPayment.requestedBy?.email || vendorPayment.requestedBy?.phone || "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created At</dt>
                <dd>{formatDateTime(vendorPayment.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Updated At</dt>
                <dd>{formatDateTime(vendorPayment.updatedAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Notes</dt>
                <dd>{formatOptional(vendorPayment.remarks)}</dd>
              </div>
            </dl>
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Ledger Entries</h2>
            {vendorPayment.ledgerEntries.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No ledger entries posted for this vendor payment yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Debit</th>
                      <th className="px-3 py-2">Credit</th>
                      <th className="px-3 py-2">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {vendorPayment.ledgerEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2">{formatDateTime(entry.entryDate)}</td>
                        <td className="px-3 py-2">{formatCurrencyInr(entry.debitAmount)}</td>
                        <td className="px-3 py-2">{formatCurrencyInr(entry.creditAmount)}</td>
                        <td className="px-3 py-2">{entry.description?.trim() || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {canStatusUpdate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Status</h2>
              <VendorPaymentStatusActions
                vendorPaymentId={vendorPayment.id}
                currentStatus={vendorPayment.status}
                redirectTo={`/vendor-payments/${vendorPayment.id}`}
              />
            </div>
          ) : null}
          {canDelete ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Void Payment</h2>
              <form action={deleteVendorPaymentAction.bind(null, vendorPayment.id)}>
                <input type="hidden" name="redirectTo" value={`/vendor-payments/${vendorPayment.id}`} />
                <button type="submit" className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700">
                  Void Vendor Payment
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
