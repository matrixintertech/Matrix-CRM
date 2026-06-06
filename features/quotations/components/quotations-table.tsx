import { ApprovalStatus } from "@prisma/client";

import { StatusBadge } from "@/components/admin/status-badge";
import {
  deleteQuotationAction,
  submitQuotationAction,
  updateQuotationAction,
} from "@/features/quotations/actions/quotation.actions";
import { QuotationForm } from "@/features/quotations/components/quotation-form";
import { QuotationStatusActions } from "@/features/quotations/components/quotation-status-actions";
import { formatDateTime } from "@/lib/utils/format";

type QuotationRow = {
  id: string;
  quotationNumber: string;
  status: ApprovalStatus;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    itemId: string;
    description: string | null;
    quantity: number;
    unitRate: number;
    taxPercent: number | null;
    amount: number;
    item: {
      id: string;
      code: string;
      name: string;
      unit: string;
    };
  }>;
};

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  defaultUnitRate?: string;
  defaultTaxPercent?: string;
};

type QuotationsTableProps = {
  serviceRequestId: string;
  redirectTo: string;
  quotations: QuotationRow[];
  itemOptions: ItemOption[];
  canUpdate: boolean;
  canDelete: boolean;
  canUpdateStatus: boolean;
  canSubmit: boolean;
};

export function QuotationsTable({
  serviceRequestId,
  redirectTo,
  quotations,
  itemOptions,
  canUpdate,
  canDelete,
  canUpdateStatus,
  canSubmit,
}: QuotationsTableProps) {
  if (quotations.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No quotation created yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3 md:hidden">
        {quotations.map((quotation) => (
          <article key={quotation.id} className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{quotation.quotationNumber}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">Valid until: {formatDateTime(quotation.validUntil)}</p>
              </div>
              <StatusBadge value={quotation.status} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Subtotal</p>
                <p className="mt-1 text-sm text-slate-900">INR {quotation.subtotal.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Tax Total</p>
                <p className="mt-1 text-sm text-slate-900">INR {quotation.taxTotal.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Grand Total</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">INR {quotation.grandTotal.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Lines</p>
                <p className="mt-1 text-sm text-slate-900">{quotation.items.length}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {canUpdateStatus ? <QuotationStatusActions quotationId={quotation.id} currentStatus={quotation.status} redirectTo={redirectTo} /> : null}
              {canSubmit ? (
                <form action={submitQuotationAction.bind(null, quotation.id)}>
                  <input type="hidden" name="redirectTo" value={redirectTo} />
                  <button type="submit" className="min-h-11 w-full rounded-xl border border-indigo-200 px-3 text-sm font-medium text-indigo-700">
                    Submit
                  </button>
                </form>
              ) : null}
              {canDelete ? (
                <form action={deleteQuotationAction.bind(null, quotation.id)}>
                  <input type="hidden" name="redirectTo" value={redirectTo} />
                  <button type="submit" className="min-h-11 w-full rounded-xl border border-red-200 px-3 text-sm font-medium text-red-700">
                    Delete
                  </button>
                </form>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <div className="crm-scroll-shell hidden rounded-md border border-[var(--border)] md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Quotation</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Subtotal</th>
              <th className="px-3 py-2">Tax Total</th>
              <th className="px-3 py-2">Grand Total</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {quotations.map((quotation) => (
              <tr key={quotation.id} className="border-t border-[var(--border)] align-top">
                <td className="px-3 py-2">
                  <p className="font-medium">{quotation.quotationNumber}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Valid until: {formatDateTime(quotation.validUntil)} | Lines: {quotation.items.length}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge value={quotation.status} />
                </td>
                <td className="px-3 py-2">INR {quotation.subtotal.toFixed(2)}</td>
                <td className="px-3 py-2">INR {quotation.taxTotal.toFixed(2)}</td>
                <td className="px-3 py-2 font-semibold">INR {quotation.grandTotal.toFixed(2)}</td>
                <td className="px-3 py-2">{formatDateTime(quotation.createdAt)}</td>
                <td className="px-3 py-2">
                  <div className="space-y-2">
                    {canUpdateStatus ? (
                      <QuotationStatusActions quotationId={quotation.id} currentStatus={quotation.status} redirectTo={redirectTo} />
                    ) : null}
                    {canSubmit ? (
                      <form action={submitQuotationAction.bind(null, quotation.id)}>
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <button type="submit" className="rounded-md border border-indigo-200 px-2 py-1 text-xs text-indigo-700">
                          Submit
                        </button>
                      </form>
                    ) : null}
                    {canDelete ? (
                      <form action={deleteQuotationAction.bind(null, quotation.id)}>
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <button type="submit" className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-700">
                          Delete
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {quotations.map((quotation) => (
        <details key={`${quotation.id}-lines`} className="rounded-md border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-sm font-medium text-[var(--primary)]">
            View lines for {quotation.quotationNumber}
          </summary>
          <div className="mt-3 crm-scroll-shell rounded-md border border-[var(--border)]">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="px-2 py-2">Item</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2">Qty</th>
                  <th className="px-2 py-2">Unit Rate</th>
                  <th className="px-2 py-2">Tax %</th>
                  <th className="px-2 py-2">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {quotation.items.map((line) => (
                  <tr key={line.id} className="border-t border-[var(--border)]">
                    <td className="px-2 py-2">{line.item.name}</td>
                    <td className="px-2 py-2">{line.description || "-"}</td>
                    <td className="px-2 py-2">{line.quantity.toFixed(3)}</td>
                    <td className="px-2 py-2">INR {line.unitRate.toFixed(2)}</td>
                    <td className="px-2 py-2">{line.taxPercent?.toFixed(2) ?? "0.00"}</td>
                    <td className="px-2 py-2">INR {line.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {canUpdate ? (
        <div className="space-y-2">
          {quotations.map((quotation) => (
            <details key={`${quotation.id}-edit`} className="rounded-md border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-sm font-medium text-[var(--primary)]">Edit {quotation.quotationNumber}</summary>
              <div className="mt-3">
                <QuotationForm
                  action={updateQuotationAction.bind(null, quotation.id)}
                  serviceRequestId={serviceRequestId}
                  redirectTo={redirectTo}
                  itemOptions={itemOptions}
                  submitLabel="Update quotation"
                  compact
                  quotation={{
                    validUntil: quotation.validUntil,
                    notes: quotation.notes,
                    lines: quotation.items.map((line) => ({
                      itemId: line.itemId,
                      description: line.description,
                      quantity: line.quantity.toFixed(3),
                      unitRate: line.unitRate.toFixed(2),
                      taxPercent: line.taxPercent === null ? null : line.taxPercent.toFixed(2),
                    })),
                  }}
                />
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  );
}
