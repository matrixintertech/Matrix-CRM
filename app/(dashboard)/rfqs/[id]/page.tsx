import { RfqVendorStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { RfqStatusActions } from "@/features/rfqs/components/rfq-status-actions";
import { RfqSummaryCard } from "@/features/rfqs/components/rfq-summary-card";
import { getRfqById } from "@/features/rfqs/services/rfq.service";
import { updateRfqVendorQuoteAction } from "@/features/rfqs/actions/rfq.actions";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatCurrencyInr, formatDateTime, formatOptional } from "@/lib/utils/format";

type RfqDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "RFQ created successfully.";
  }
  if (code === "updated") {
    return "RFQ updated successfully.";
  }
  if (code === "sent") {
    return "RFQ sent to vendors successfully.";
  }
  if (code === "vendor-quote-updated") {
    return "Vendor quotation updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "RFQ validation failed.";
  }
  if (code === "status-validation") {
    return "RFQ status update validation failed.";
  }
  if (code === "vendor-quote-validation") {
    return "Vendor quotation validation failed.";
  }
  if (code === "mismatch") {
    return "RFQ update blocked by tenant scope mismatch.";
  }
  if (code === "invalid-transition") {
    return "RFQ status transition is not allowed.";
  }
  if (code === "send-prerequisite") {
    return "RFQ must have at least one line item and one vendor before sending.";
  }
  if (code === "not-found") {
    return "RFQ record could not be found.";
  }
  return undefined;
}

export default async function RfqDetailPage({ params, searchParams }: RfqDetailPageProps) {
  const session = await requirePermission("rfq.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const rfq = await getRfqById(session, id);

  if (!rfq) {
    notFound();
  }

  const [canUpdate, canDelete, canStatusUpdate, canSend, canVendorQuotationUpdate] = await Promise.all([
    hasPermission(session, "rfq.update"),
    hasPermission(session, "rfq.delete"),
    hasPermission(session, "rfq.status.update"),
    hasPermission(session, "rfq.send"),
    hasPermission(session, "vendor_quotations.update"),
  ]);

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="crm-page">
      <PageHeader
        title={rfq.title}
        description="Review RFQ details, line items, vendor coverage, and quote capture."
        action={canUpdate ? { label: "Edit RFQ", href: `/rfqs/${rfq.id}/edit` } : undefined}
      />
      <div>
        <Link href="/rfqs" className="crm-back-link">
          Back to RFQs
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
                <dt className="text-[var(--muted)]">RFQ Number</dt>
                <dd>{rfq.rfqNumber}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={rfq.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Partner</dt>
                <dd>
                  {rfq.servicePartner.name} ({rfq.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Client</dt>
                <dd>{rfq.client ? `${rfq.client.name} (${rfq.client.code})` : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service Request</dt>
                <dd>{rfq.serviceRequest ? `${rfq.serviceRequest.serviceNumber} - ${rfq.serviceRequest.title}` : "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Due Date</dt>
                <dd>{formatDateTime(rfq.dueDate)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Description</dt>
                <dd>{formatOptional(rfq.description)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created By</dt>
                <dd>{rfq.createdBy?.name ?? rfq.createdBy?.email ?? rfq.createdBy?.phone ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(rfq.createdAt)}</dd>
              </div>
            </dl>
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Line Items</h2>
            {rfq.items.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No line items added.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2">Quantity</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Specifications</th>
                      <th className="px-3 py-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rfq.items.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2">
                          {line.item.name} ({line.item.code})
                        </td>
                        <td className="px-3 py-2">{Number(line.quantity).toFixed(3)}</td>
                        <td className="px-3 py-2">{line.item.unit}</td>
                        <td className="px-3 py-2">{formatOptional(line.specs)}</td>
                        <td className="px-3 py-2">{formatOptional(line.remarks)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">RFQ Vendors</h2>
            {rfq.vendorQuotes.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No vendors assigned.</p>
            ) : (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Vendor</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Quoted Amount</th>
                        <th className="px-3 py-2">Notes</th>
                        <th className="px-3 py-2">Submitted</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rfq.vendorQuotes.map((quote) => (
                        <tr key={quote.id}>
                          <td className="px-3 py-2">
                            {quote.vendor.name} ({quote.vendor.code})
                          </td>
                          <td className="px-3 py-2">
                            <StatusBadge value={quote.status} />
                          </td>
                          <td className="px-3 py-2">{formatCurrencyInr(quote.quotedAmount === null ? null : Number(quote.quotedAmount))}</td>
                          <td className="px-3 py-2">{formatOptional(quote.notes)}</td>
                          <td className="px-3 py-2">{formatDateTime(quote.submittedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {canVendorQuotationUpdate ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Capture Vendor Quotations</h3>
                    {rfq.vendorQuotes.map((quote) => (
                      <form
                        key={`${quote.id}-capture`}
                        action={updateRfqVendorQuoteAction.bind(null, rfq.id)}
                        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[#fbfcff] p-4 md:grid-cols-12"
                      >
                        <input type="hidden" name="redirectTo" value={`/rfqs/${rfq.id}`} />
                        <input type="hidden" name="vendorId" value={quote.vendorId} />
                        <p className="text-sm font-medium md:col-span-3">
                          {quote.vendor.name} ({quote.vendor.code})
                        </p>
                        <label className="space-y-1 text-sm md:col-span-2">
                          <span className="font-medium">Status</span>
                          <select name="status" defaultValue={quote.status} className="h-10 w-full rounded-xl border border-[var(--border)] px-3">
                            {Object.values(RfqVendorStatus).map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-sm md:col-span-2">
                          <span className="font-medium">Quoted Amount</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            name="quotedAmount"
                            defaultValue={quote.quotedAmount === null ? "" : Number(quote.quotedAmount).toFixed(2)}
                            className="h-10 w-full rounded-xl border border-[var(--border)] px-3"
                          />
                        </label>
                        <label className="space-y-1 text-sm md:col-span-4">
                          <span className="font-medium">Notes</span>
                          <input
                            name="notes"
                            defaultValue={quote.notes ?? ""}
                            className="h-10 w-full rounded-xl border border-[var(--border)] px-3"
                            maxLength={600}
                          />
                        </label>
                        <div className="flex items-end md:col-span-1">
                          <button type="submit" className="h-10 w-full rounded-xl bg-[var(--primary)] px-3 text-sm font-semibold text-white">
                            Save
                          </button>
                        </div>
                      </form>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--muted)]">You do not have permission to update vendor quotations.</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <RfqSummaryCard rfq={rfq} />
          {canStatusUpdate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
              <RfqStatusActions
                rfqId={rfq.id}
                currentStatus={rfq.status}
                canDelete={canDelete}
                canSend={canSend}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
