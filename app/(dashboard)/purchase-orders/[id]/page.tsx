import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { PurchaseOrderStatusActions } from "@/features/purchase-orders/components/purchase-order-status-actions";
import { PurchaseOrderSummaryCard } from "@/features/purchase-orders/components/purchase-order-summary-card";
import { getPurchaseOrderById } from "@/features/purchase-orders/services/purchase-order.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

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

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
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

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={purchaseOrder.poNumber}
        description="Review purchase order details, linked records, line items, and status."
        action={canUpdate ? { label: "Edit PO", href: `/purchase-orders/${purchaseOrder.id}/edit` } : undefined}
      />
      <div>
        <Link href="/purchase-orders" className="text-sm text-[var(--muted)] underline">
          Back to PO list
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
                <dd>{toMoney(purchaseOrder.subtotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Tax Total</dt>
                <dd>{toMoney(purchaseOrder.taxTotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Grand Total</dt>
                <dd>{toMoney(purchaseOrder.grandTotal)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Approved</dt>
                <dd>{formatDateTime(purchaseOrder.approvedAt)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Notes</dt>
                <dd>{formatOptional(purchaseOrder.notes)}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-md border border-[var(--border)] bg-white p-5">
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
        </div>

        <div className="space-y-5">
          <PurchaseOrderSummaryCard purchaseOrder={purchaseOrder} />
          {canStatusUpdate ? (
            <div className="rounded-md border border-[var(--border)] bg-white p-5">
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
