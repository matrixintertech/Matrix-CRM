"use client";

import { useMemo, useState } from "react";

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  defaultUnitRate?: string;
  defaultTaxPercent?: string;
};

type LineState = {
  itemId: string;
  description: string;
  quantity: string;
  unitRate: string;
  taxPercent: string;
};

type QuotationLinesFormProps = {
  itemOptions: ItemOption[];
  initialLines?: Array<{
    itemId: string;
    description?: string | null;
    quantity: string;
    unitRate: string;
    taxPercent?: string | null;
  }>;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function calculateLineTotals(line: LineState) {
  const quantity = Number(line.quantity) || 0;
  const unitRate = Number(line.unitRate) || 0;
  const taxPercent = Number(line.taxPercent) || 0;
  const lineSubtotal = quantity * unitRate;
  const taxAmount = (lineSubtotal * taxPercent) / 100;
  const lineTotal = lineSubtotal + taxAmount;
  return {
    lineSubtotal,
    taxAmount,
    lineTotal,
  };
}

function getDefaultLine(item: ItemOption | undefined): LineState {
  return {
    itemId: item?.id ?? "",
    description: item?.name ?? "",
    quantity: "1",
    unitRate: item?.defaultUnitRate ?? "0.00",
    taxPercent: item?.defaultTaxPercent ?? "",
  };
}

export function QuotationLinesForm({ itemOptions, initialLines }: QuotationLinesFormProps) {
  const [lines, setLines] = useState<LineState[]>(
    initialLines && initialLines.length > 0
      ? initialLines.map((line) => ({
          itemId: line.itemId,
          description: line.description ?? "",
          quantity: line.quantity,
          unitRate: line.unitRate,
          taxPercent: line.taxPercent ?? "",
        }))
      : itemOptions.length > 0
        ? [getDefaultLine(itemOptions[0])]
        : []
  );

  const itemById = useMemo(() => new Map(itemOptions.map((item) => [item.id, item])), [itemOptions]);

  const duplicateItemIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      counts.set(line.itemId, (counts.get(line.itemId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter((entry) => entry[1] > 1).map((entry) => entry[0]));
  }, [lines]);

  const lineErrors = useMemo(
    () =>
      lines.map((line) => {
        const errors: string[] = [];
        const quantity = toNumber(line.quantity);
        const unitRate = toNumber(line.unitRate);
        const taxPercent = line.taxPercent.trim() === "" ? 0 : toNumber(line.taxPercent);

        if (!Number.isFinite(quantity) || quantity <= 0) {
          errors.push("Quantity must be greater than 0.");
        }
        if (!Number.isFinite(unitRate) || unitRate < 0) {
          errors.push("Unit rate cannot be negative.");
        }
        if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
          errors.push("Tax percent must be between 0 and 100.");
        }

        return errors;
      }),
    [lines]
  );

  const totals = useMemo(() => {
    return lines.reduce(
      (acc, line) => {
        const calculated = calculateLineTotals(line);
        acc.subtotal += calculated.lineSubtotal;
        acc.taxTotal += calculated.taxAmount;
        acc.grandTotal += calculated.lineTotal;
        return acc;
      },
      { subtotal: 0, taxTotal: 0, grandTotal: 0 }
    );
  }, [lines]);

  function addLine() {
    setLines((current) => [...current, getDefaultLine(itemOptions[0])]);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  function updateLine(index: number, next: Partial<LineState>) {
    setLines((current) =>
      current.map((line, lineIndex) => {
        if (lineIndex !== index) {
          return line;
        }
        return {
          ...line,
          ...next,
        };
      })
    );
  }

  function handleItemChange(index: number, itemId: string) {
    const item = itemById.get(itemId);
    updateLine(index, {
      itemId,
      description: item?.name ?? "",
      unitRate: item?.defaultUnitRate ?? "0.00",
      taxPercent: item?.defaultTaxPercent ?? "",
    });
  }

  const linesPayload = JSON.stringify(
    lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      quantity: line.quantity,
      unitRate: line.unitRate,
      taxPercent: line.taxPercent === "" ? undefined : line.taxPercent,
    }))
  );

  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Quotation lines</h3>
        <button
          type="button"
          onClick={addLine}
          className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium"
          disabled={itemOptions.length === 0}
        >
          Add line
        </button>
      </div>
      {itemOptions.length === 0 ? (
        <p className="text-sm text-red-700">No active items available for this service request tenant.</p>
      ) : null}
      {lines.length === 0 ? <p className="text-sm text-[var(--muted)]">No lines added yet.</p> : null}
      {lines.map((line, index) => {
        const calculated = calculateLineTotals(line);
        return (
          <div key={`${line.itemId}-${index}`} className="space-y-2 rounded-md border border-[var(--border)] p-3">
            <div className="grid gap-2 md:grid-cols-12">
              <label className="space-y-1 text-sm md:col-span-5">
                <span className="font-medium">Item</span>
                <select
                  value={line.itemId}
                  onChange={(event) => handleItemChange(index, event.target.value)}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                >
                  {itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.code}) / {item.unit}
                    </option>
                  ))}
                </select>
                {duplicateItemIds.has(line.itemId) ? (
                  <p className="text-xs text-red-700">Duplicate item lines are not allowed.</p>
                ) : null}
              </label>
              <label className="space-y-1 text-sm md:col-span-3">
                <span className="font-medium">Quantity</span>
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={line.quantity}
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">Unit Rate</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.unitRate}
                  onChange={(event) => updateLine(index, { unitRate: event.target.value })}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">Tax %</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={line.taxPercent}
                  onChange={(event) => updateLine(index, { taxPercent: event.target.value })}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr,auto]">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Description</span>
                <input
                  value={line.description}
                  onChange={(event) => updateLine(index, { description: event.target.value })}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                  maxLength={400}
                />
              </label>
              <div className="flex items-end gap-2">
                <p className="text-xs text-[var(--muted)]">Line total: INR {calculated.lineTotal.toFixed(2)}</p>
                <button
                  type="button"
                  onClick={() => removeLine(index)}
                  className="h-9 rounded-md border border-red-200 px-2 text-xs text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
            {lineErrors[index]?.length ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                {lineErrors[index]?.join(" ")}
              </div>
            ) : null}
          </div>
        );
      })}
      <input type="hidden" name="linesJson" value={linesPayload} />
      <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <p>Subtotal: INR {totals.subtotal.toFixed(2)}</p>
        <p>Tax Total: INR {totals.taxTotal.toFixed(2)}</p>
        <p className="font-semibold">Grand Total: INR {totals.grandTotal.toFixed(2)}</p>
      </div>
    </div>
  );
}
