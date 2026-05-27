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
  rate: string;
  taxPercent: string;
};

type RateCardLinesFormProps = {
  itemOptions: ItemOption[];
  initialLines?: Array<{
    itemId: string;
    rate: string;
    taxPercent?: string;
  }>;
};

export function RateCardLinesForm({ itemOptions, initialLines }: RateCardLinesFormProps) {
  const [lines, setLines] = useState<LineState[]>(
    initialLines && initialLines.length > 0
      ? initialLines.map((line) => ({
          itemId: line.itemId,
          rate: line.rate,
          taxPercent: line.taxPercent ?? "",
        }))
      : itemOptions.length > 0
        ? [{ itemId: itemOptions[0]?.id ?? "", rate: "0", taxPercent: "" }]
        : []
  );

  const duplicateItemIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const line of lines) {
      counts.set(line.itemId, (counts.get(line.itemId) ?? 0) + 1);
    }
    return new Set(Array.from(counts.entries()).filter((entry) => entry[1] > 1).map((entry) => entry[0]));
  }, [lines]);

  function addLine() {
    setLines((current) => [
      ...current,
      {
        itemId: itemOptions[0]?.id ?? "",
        rate: "0",
        taxPercent: "",
      },
    ]);
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

  const linesPayload = JSON.stringify(
    lines.map((line) => ({
      itemId: line.itemId,
      rate: line.rate,
      taxPercent: line.taxPercent === "" ? undefined : line.taxPercent,
    }))
  );

  return (
    <div className="space-y-3 rounded-md border border-[var(--border)] bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Rate card lines</h3>
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
        <p className="text-sm text-red-700">No items available for the selected service partner.</p>
      ) : null}
      {lines.length === 0 ? <p className="text-sm text-[var(--muted)]">No lines added yet.</p> : null}
      {lines.map((line, index) => (
        <div key={`${line.itemId}-${index}`} className="grid gap-2 rounded-md border border-[var(--border)] p-3 md:grid-cols-12">
          <label className="space-y-1 text-sm md:col-span-5">
            <span className="font-medium">Item</span>
            <select
              value={line.itemId}
              onChange={(event) => updateLine(index, { itemId: event.target.value })}
              className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            >
              {itemOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.code}){item.active ? "" : " [inactive]"}
                </option>
              ))}
            </select>
            {duplicateItemIds.has(line.itemId) ? (
              <p className="text-xs text-red-700">Duplicate item lines are not allowed.</p>
            ) : null}
          </label>
          <label className="space-y-1 text-sm md:col-span-3">
            <span className="font-medium">Rate</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={line.rate}
              onChange={(event) => updateLine(index, { rate: event.target.value })}
              className="h-9 w-full rounded-md border border-[var(--border)] px-3"
            />
          </label>
          <label className="space-y-1 text-sm md:col-span-3">
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
          <div className="flex items-end md:col-span-1">
            <button
              type="button"
              onClick={() => removeLine(index)}
              className="h-9 w-full rounded-md border border-red-200 px-2 text-xs text-red-700"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <input type="hidden" name="linesJson" value={linesPayload} />
      <p className="text-xs text-[var(--muted)]">Total lines: {lines.length}</p>
    </div>
  );
}
