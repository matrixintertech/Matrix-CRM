import { PurchaseOrderStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { listInvoicesForPurchaseOrder } from "@/features/invoices/services/invoice.service";
import { PurchaseOrderStatusActions } from "@/features/purchase-orders/components/purchase-order-status-actions";
import { PurchaseOrderSummaryCard } from "@/features/purchase-orders/components/purchase-order-summary-card";
import { getPurchaseOrderById } from "@/features/purchase-orders/services/purchase-order.service";
import { VendorPaymentsTable } from "@/features/vendor-payments/components/vendor-payments-table";
import { listVendorPaymentsForPurchaseOrder } from "@/features/vendor-payments/services/vendor-payment.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr, formatDateTime, formatOptional } from "@/lib/utils/format";

type PurchaseOrderDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Purchase order created successfully.";
  }
  if (code === "updated") {
    return "Purchase order updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Purchase order validation failed.";
  }
  if (code === "status-validation") {
    return "Purchase order status validation failed.";
  }
  if (code === "mismatch") {
    return "Purchase order update blocked by tenant scope mismatch.";
  }
  if (code === "invalid-transition") {
    return "Purchase order status transition is not allowed.";
  }
  if (code === "not-found") {
    return "Purchase order record could not be found.";
  }
  return undefined;
}

export default async function PurchaseOrderDetailPage({ params, searchParams }: PurchaseOrderDetailPageProps) {
  const session = await requirePermission("purchase_orders.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const purchaseOrder = await getPurchaseOrderById(session, id);

  if (!purchaseOrder) {
    notFound();
  }

  const [canUpdate, canDelete, canStatusUpdate] = await Promise.all([
    hasPermission(session, "purchase_orders.update"),
    hasPermission(session, "purchase_orders.delete"),
    hasPermission(session, "purchase_orders.status.update"),
  ]);
  const [canReadInvoices, canCreateInvoice, canReadVendorPayments, canCreateVendorPayment, canUpdateVendorPayments, canDeleteVendorPayments, canUpdateVendorPaymentStatus] = await Promise.all([
    hasPermission(session, "invoices.read"),
    hasPermission(session, "invoices.create"),
    hasPermission(session, "vendor_payments.read"),
    hasPermission(session, "vendor_payments.create"),
    hasPermission(session, "vendor_payments.update"),
    hasPermission(session, "vendor_payments.delete"),
    hasPermission(session, "vendor_payments.status.update"),
  ]);
  const [relatedInvoices, relatedVendorPayments] = await Promise.all([
    canReadInvoices ? listInvoicesForPurchaseOrder(session, purchaseOrder.id) : Promise.resolve([]),
    canReadVendorPayments ? listVendorPaymentsForPurchaseOrder(session, purchaseOrder.id) : Promise.resolve([]),
  ]);
  const invoiceEligiblePoStatuses = new Set<PurchaseOrderStatus>([
    PurchaseOrderStatus.APPROVED,
    PurchaseOrderStatus.ISSUED,
    PurchaseOrderStatus.PARTIALLY_FULFILLED,
    PurchaseOrderStatus.FULFILLED,
  ]);
  const canCreateInvoiceFromPo = canCreateInvoice && invoiceEligiblePoStatuses.has(purchaseOrder.status);
  const canCreateVendorPaymentFromPo = canCreateVendorPayment && invoiceEligiblePoStatuses.has(purchaseOrder.status);

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="crm-page">
      <PageHeader
        title={purchaseOrder.poNumber}
        description="Review purchase order details, linked records, line items, and status."
        action={canUpdate ? { label: "Edit PO", href: `/purchase-orders/${purchaseOrder.id}/edit` } : undefined}
      />
      <div>
        <Link href="/purchase-orders" className="crm-back-link">
          Back to PO list
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">PO Number</dt>
                <dd>{purchaseOrder.poNumber}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={purchaseOrder.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Partner</dt>
                <dd>
                  {purchaseOrder.servicePartner.name} ({purchaseOrder.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Vendor</dt>
                <dd>
                  {purchaseOrder.vendor.name} ({purchaseOrder.vendor.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">RFQ</dt>
                <dd>{purchaseOrder.rfq ? `${purchaseOrder.rfq.rfqNumber} - ${purchaseOrder.rfq.title}` : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Request</dt>
                <dd>{purchaseOrder.serviceRequest ? `${purchaseOrder.serviceRequest.serviceNumber} - ${purchaseOrder.serviceRequest.title}` : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Order Date</dt>
                <dd>{formatDateTime(purchaseOrder.orderDate)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Expected Date</dt>
                <dd>{formatDateTime(purchaseOrder.expectedDate)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Subtotal</dt>
                <dd>{formatCurrencyInr(purchaseOrder.subtotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Tax Total</dt>
                <dd>{formatCurrencyInr(purchaseOrder.taxTotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Grand Total</dt>
                <dd>{formatCurrencyInr(purchaseOrder.grandTotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Approved</dt>
                <dd>{formatDateTime(purchaseOrder.approvedAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Notes</dt>
                <dd>{formatOptional(purchaseOrder.notes)}</dd>
              </div>
              {canCreateInvoiceFromPo ? (
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <Link
                    href={`/invoices/new?purchaseOrderId=${purchaseOrder.id}&servicePartnerId=${purchaseOrder.servicePartnerId}`}
                    className="inline-flex rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-[var(--primary)]"
                  >
                    Create Invoice
                  </Link>
                  {canCreateVendorPaymentFromPo ? (
                    <Link
                      href={`/vendor-payments/new?purchaseOrderId=${purchaseOrder.id}&servicePartnerId=${purchaseOrder.servicePartnerId}`}
                      className="inline-flex rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-[var(--primary)]"
                    >
                      Record Vendor Payment
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </dl>
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Line Items</h2>
            {purchaseOrder.items.length === 0 ? (
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
                    {purchaseOrder.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          {line.item.name} ({line.item.code})
                        </td>
                        <td className="px-3 py-2">{Number(line.quantity).toFixed(3)}</td>
                        <td className="px-3 py-2">{line.item.unit}</td>
                        <td className="px-3 py-2">{formatCurrencyInr(line.unitRate)}</td>
                        <td className="px-3 py-2">{line.taxPercent === null ? "-" : Number(line.taxPercent).toFixed(2)}</td>
                        <td className="px-3 py-2">{formatCurrencyInr(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {canReadInvoices ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Related Invoices</h2>
              {relatedInvoices.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No invoices created for this purchase order yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Invoice</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Lines</th>
                        <th className="px-3 py-2">Grand Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {relatedInvoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td className="px-3 py-2">
                            <Link href={`/invoices/${invoice.id}`} className="text-[var(--primary)] underline">
                              {invoice.invoiceNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge value={invoice.status} />
                          </td>
                          <td className="px-3 py-2">{formatDateTime(invoice.invoiceDate)}</td>
                          <td className="px-3 py-2">{invoice._count.items}</td>
                          <td className="px-3 py-2">{formatCurrencyInr(invoice.grandTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {canReadVendorPayments ? (
            <div className="crm-panel">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Vendor Payments</h2>
                {canCreateVendorPaymentFromPo ? (
                  <Link
                    href={`/vendor-payments/new?purchaseOrderId=${purchaseOrder.id}&servicePartnerId=${purchaseOrder.servicePartnerId}`}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-[var(--primary)]"
                  >
                    Record Vendor Payment
                  </Link>
                ) : null}
              </div>
              <VendorPaymentsTable
                vendorPayments={relatedVendorPayments}
                redirectTo={`/purchase-orders/${purchaseOrder.id}`}
                canUpdate={canUpdateVendorPayments}
                canDelete={canDeleteVendorPayments}
                canStatusUpdate={canUpdateVendorPaymentStatus}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <PurchaseOrderSummaryCard purchaseOrder={purchaseOrder} />
          {canStatusUpdate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
              <PurchaseOrderStatusActions
                purchaseOrderId={purchaseOrder.id}
                currentStatus={purchaseOrder.status}
                canDelete={canDelete}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
