"use client";

import { QuotationLinesForm } from "@/features/quotations/components/quotation-lines-form";

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  defaultUnitRate?: string;
  defaultTaxPercent?: string;
};

type QuotationFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  serviceRequestId: string;
  redirectTo: string;
  itemOptions: ItemOption[];
  submitLabel: string;
  compact?: boolean;
  errorMessage?: string;
  quotation?: {
    validUntil: Date | null;
    notes: string | null;
    lines: Array<{
      itemId: string;
      description: string | null;
      quantity: string;
      unitRate: string;
      taxPercent: string | null;
    }>;
  };
};

function toDateInput(value: Date | null) {
  if (!value) {
    return "";
  }
  return new Date(value).toISOString().slice(0, 10);
}

export function QuotationForm({
  action,
  serviceRequestId,
  redirectTo,
  itemOptions,
  submitLabel,
  compact = false,
  errorMessage,
  quotation,
}: QuotationFormProps) {
  return (
    <form action={action} className={compact ? "space-y-3" : "space-y-4 rounded-md border border-[var(--border)] p-4"}>
      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      <input type="hidden" name="serviceRequestId" value={serviceRequestId} />
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="grid gap-2 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Valid until</span>
          <input
            type="date"
            name="validUntil"
            defaultValue={toDateInput(quotation?.validUntil ?? null)}
            className="h-9 w-full rounded-md border border-[var(--border)] px-3"
          />
        </label>
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="font-medium">Remarks</span>
          <textarea
            name="notes"
            defaultValue={quotation?.notes ?? ""}
            className="min-h-20 w-full rounded-md border border-[var(--border)] px-3 py-2"
            maxLength={1200}
          />
        </label>
      </div>

      <QuotationLinesForm itemOptions={itemOptions} initialLines={quotation?.lines} />

      <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium">
        {submitLabel}
      </button>
    </form>
  );
}
