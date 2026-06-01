import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { InvoiceStatusActions } from "@/features/invoices/components/invoice-status-actions";
import { InvoiceSummaryCard } from "@/features/invoices/components/invoice-summary-card";
import { getInvoiceById } from "@/features/invoices/services/invoice.service";
import { createPaymentAction } from "@/features/payments/actions/payment.actions";
import { PaymentForm } from "@/features/payments/components/payment-form";
import { PaymentsTable } from "@/features/payments/components/payments-table";
import { PaymentSummaryCard } from "@/features/payments/components/payment-summary-card";
import { listPaymentsForInvoice } from "@/features/payments/services/payment.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type InvoiceDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Invoice created successfully.";
  }
  if (code === "updated") {
    return "Invoice updated successfully.";
  }
  if (code === "payment-recorded") {
    return "Payment recorded successfully.";
  }
  if (code === "payment-updated") {
    return "Payment updated successfully.";
  }
  if (code === "payment-status-updated") {
    return "Payment status updated successfully.";
  }
  if (code === "payment-deleted") {
    return "Payment voided successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Invoice validation failed.";
  }
  if (code === "status-validation") {
    return "Invoice status validation failed.";
  }
  if (code === "mismatch") {
    return "Invoice update blocked by tenant scope mismatch.";
  }
  if (code === "invalid-transition") {
    return "Invoice status transition is not allowed.";
  }
  if (code === "edit-blocked") {
    return "Invoice cannot be edited in the current status.";
  }
  if (code === "not-found") {
    return "Invoice record could not be found.";
  }
  if (code === "payment-validation") {
    return "Payment validation failed.";
  }
  if (code === "payment-status-validation") {
    return "Payment status validation failed.";
  }
  if (code === "payment-overpayment") {
    return "Payment amount cannot exceed invoice balance due.";
  }
  if (code === "payment-mismatch") {
    return "Payment action blocked by tenant scope mismatch.";
  }
  if (code === "payment-duplicate") {
    return "Duplicate payment number detected.";
  }
  return undefined;
}

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

export default async function InvoiceDetailPage({ params, searchParams }: InvoiceDetailPageProps) {
  const session = await requirePermission("invoices.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const invoice = await getInvoiceById(session, id);

  if (!invoice) {
    notFound();
  }

  const [canUpdate, canDelete, canStatusUpdate, canReadPayments, canCreatePayments, canUpdatePayments, canDeletePayments, canUpdatePaymentStatus] =
    await Promise.all([
    hasPermission(session, "invoices.update"),
    hasPermission(session, "invoices.delete"),
    hasPermission(session, "invoices.status.update"),
    hasPermission(session, "payments.read"),
    hasPermission(session, "payments.create"),
    hasPermission(session, "payments.update"),
    hasPermission(session, "payments.delete"),
    hasPermission(session, "payments.status.update"),
  ]);

  const paymentData = canReadPayments ? await listPaymentsForInvoice(session, invoice.id) : null;

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={invoice.invoiceNumber}
        description="Review invoice details, linked records, line items, and status."
        action={canUpdate ? { label: "Edit Invoice", href: `/invoices/${invoice.id}/edit` } : undefined}
      />
      <div>
        <Link href="/invoices" className="text-sm text-[var(--muted)] underline">
          Back to invoice list
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Invoice Number</dt>
                <dd>{invoice.invoiceNumber}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={invoice.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Partner</dt>
                <dd>
                  {invoice.servicePartner.name} ({invoice.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Vendor</dt>
                <dd>
                  {invoice.vendor.name} ({invoice.vendor.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Purchase Order</dt>
                <dd>{invoice.purchaseOrder ? invoice.purchaseOrder.poNumber : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">RFQ</dt>
                <dd>{invoice.rfq ? `${invoice.rfq.rfqNumber} - ${invoice.rfq.title}` : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Request</dt>
                <dd>{invoice.serviceRequest ? `${invoice.serviceRequest.serviceNumber} - ${invoice.serviceRequest.title}` : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Invoice Date</dt>
                <dd>{formatDateTime(invoice.invoiceDate)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Due Date</dt>
                <dd>{formatDateTime(invoice.dueDate)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Subtotal</dt>
                <dd>{toMoney(invoice.subtotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Tax Total</dt>
                <dd>{toMoney(invoice.taxTotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Grand Total</dt>
                <dd>{toMoney(invoice.grandTotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Balance Due</dt>
                <dd>{toMoney(paymentData?.summary.balanceDue ?? Number(invoice.grandTotal))}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Approved</dt>
                <dd>{formatDateTime(invoice.approvedAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Remarks</dt>
                <dd>{formatOptional(invoice.notes)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Line Items</h2>
            {invoice.items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No line items added.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Unit Rate</th>
                      <th className="px-3 py-2">Tax %</th>
                      <th className="px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoice.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          {line.item.name} ({line.item.code})
                        </td>
                        <td className="px-3 py-2">{Number(line.quantity).toFixed(3)}</td>
                        <td className="px-3 py-2">{line.item.unit}</td>
                        <td className="px-3 py-2">{toMoney(line.unitRate)}</td>
                        <td className="px-3 py-2">{line.taxPercent === null ? "-" : Number(line.taxPercent).toFixed(2)}</td>
                        <td className="px-3 py-2">{toMoney(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Payment History</h2>
              {canCreatePayments ? (
                <span className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600">Record Payment</span>
              ) : null}
            </div>
            {!canReadPayments ? (
              <p className="text-sm text-[var(--muted)]">You do not have permission to view payment history.</p>
            ) : (
              <div className="space-y-4">
                <PaymentsTable
                  invoiceId={invoice.id}
                  redirectTo={`/invoices/${invoice.id}`}
                  payments={paymentData?.payments ?? []}
                  canUpdate={canUpdatePayments}
                  canDelete={canDeletePayments}
                  canStatusUpdate={canUpdatePaymentStatus}
                />
                {canCreatePayments ? (
                  <div className="rounded-md border border-[var(--border)] p-3">
                    <h3 className="mb-2 text-sm font-semibold">Record Payment</h3>
                    <PaymentForm
                      action={createPaymentAction}
                      invoiceId={invoice.id}
                      redirectTo={`/invoices/${invoice.id}`}
                      submitLabel="Save Payment"
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <InvoiceSummaryCard
            invoice={invoice}
            paidAmount={paymentData?.summary.paidAmount}
            balanceDue={paymentData?.summary.balanceDue}
            paymentStatus={paymentData?.summary.paymentStatus}
          />
          {canReadPayments && paymentData ? (
            <PaymentSummaryCard
              grandTotal={paymentData.summary.grandTotal}
              paidAmount={paymentData.summary.paidAmount}
              balanceDue={paymentData.summary.balanceDue}
              paymentStatus={paymentData.summary.paymentStatus}
            />
          ) : null}
          {canStatusUpdate ? (
            <div className="rounded-md border border-[var(--border)] bg-white p-5">
              <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
              <InvoiceStatusActions invoiceId={invoice.id} currentStatus={invoice.status} canDelete={canDelete} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
