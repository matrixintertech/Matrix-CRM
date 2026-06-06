"use client";

import { useMemo, useState } from "react";

type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  active: boolean;
};

type LineState = {
  itemId: string;
  description: string;
  quantity: string;
  specs: string;
  remarks: string;
};

type RfqLinesFormProps = {
  itemOptions: ItemOption[];
  initialLines?: Array<{
    itemId: string;
    description?: string | null;
    quantity: string;
    specs?: string | null;
    remarks?: string | null;
  }>;
};

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getDefaultLine(item: ItemOption | undefined): LineState {
  return {
    itemId: item?.id ?? "",
    description: item?.name ?? "",
    quantity: "1",
    specs: "",
    remarks: "",
  };
}

export function RfqLinesForm({ itemOptions, initialLines }: RfqLinesFormProps) {
  const [lines, setLines] = useState<LineState[]>(
    initialLines && initialLines.length > 0
      ? initialLines.map((line) => ({
          itemId: line.itemId,
          description: line.description ?? "",
          quantity: line.quantity,
          specs: line.specs ?? "",
          remarks: line.remarks ?? "",
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
        if (!Number.isFinite(quantity) || quantity <= 0) {
          errors.push("Quantity must be greater than 0.");
        }
        return errors;
      }),
    [lines]
  );

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
    });
  }

  const linesPayload = JSON.stringify(
    lines.map((line) => ({
      itemId: line.itemId,
      description: line.description,
      quantity: line.quantity,
      specs: line.specs,
      remarks: line.remarks,
    }))
  );

  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] bg-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold">RFQ lines</h3>
        <button
          type="button"
          onClick={addLine}
          className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium"
          disabled={itemOptions.length === 0}
        >
          Add line
        </button>
      </div>
      {itemOptions.length === 0 ? <p className="text-sm text-red-700">No active items available for the selected service partner.</p> : null}
      {lines.length === 0 ? <p className="text-sm text-[var(--muted)]">No lines added yet.</p> : null}
      {lines.map((line, index) => {
        const selectedItem = itemById.get(line.itemId);
        return (
          <div key={`${line.itemId}-${index}`} className="space-y-2 rounded-md border border-[var(--border)] p-3">
            <div className="grid gap-2 md:grid-cols-12">
              <label className="space-y-1 text-sm md:col-span-6">
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
                {duplicateItemIds.has(line.itemId) ? <p className="text-xs text-red-700">Duplicate line items are not allowed.</p> : null}
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
              <label className="space-y-1 text-sm md:col-span-3">
                <span className="font-medium">Unit</span>
                <input
                  value={selectedItem?.unit ?? "-"}
                  disabled
                  className="h-9 w-full rounded-md border border-[var(--border)] bg-slate-50 px-3 text-[var(--muted)]"
                />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium">Description</span>
                <input
                  value={line.description}
                  onChange={(event) => updateLine(index, { description: event.target.value })}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                  maxLength={400}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">Specifications</span>
                <input
                  value={line.specs}
                  onChange={(event) => updateLine(index, { specs: event.target.value })}
                  className="h-9 w-full rounded-md border border-[var(--border)] px-3"
                  maxLength={500}
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="font-medium">Remarks</span>
                <textarea
                  value={line.remarks}
                  onChange={(event) => updateLine(index, { remarks: event.target.value })}
                  className="min-h-16 w-full rounded-md border border-[var(--border)] px-3 py-2"
                  maxLength={300}
                />
              </label>
            </div>
            <div className="flex items-center justify-end">
              <button type="button" onClick={() => removeLine(index)} className="h-10 w-full rounded-xl border border-red-200 px-3 text-xs font-medium text-red-700 sm:w-auto">
                Remove
              </button>
            </div>
            {lineErrors[index]?.length ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">{lineErrors[index]?.join(" ")}</div>
            ) : null}
          </div>
        );
      })}
      <input type="hidden" name="linesJson" value={linesPayload} />
      <p className="text-xs text-[var(--muted)]">Total lines: {lines.length}</p>
    </div>
  );
}
