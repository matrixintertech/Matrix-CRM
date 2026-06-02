import { LedgerSourceType } from "@prisma/client";

type LedgerFiltersProps = {
  q?: string;
  sourceType?: LedgerSourceType;
  dateFrom?: string;
  dateTo?: string;
};

export function LedgerFilters({ q, sourceType, dateFrom, dateTo }: LedgerFiltersProps) {
  return (
    <form className="grid gap-2 rounded-2xl border border-[#d7e3f6] bg-white p-4 shadow-[0_10px_30px_rgba(25,56,120,0.06)] md:grid-cols-5">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="Search by payment, invoice, request, description"
        className="h-10 min-w-0 rounded-md border border-[var(--border)] px-3 text-sm"
      />
      <select
        name="sourceType"
        defaultValue={sourceType ?? ""}
        className="h-10 rounded-md border border-[var(--border)] px-3 text-sm"
      >
        <option value="">All sources</option>
        {Object.values(LedgerSourceType).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <input type="date" name="dateFrom" defaultValue={dateFrom ?? ""} className="h-10 rounded-md border border-[var(--border)] px-3 text-sm" />
      <input type="date" name="dateTo" defaultValue={dateTo ?? ""} className="h-10 rounded-md border border-[var(--border)] px-3 text-sm" />
      <button type="submit" className="h-10 rounded-md border border-slate-200 px-3 text-sm font-medium">
        Apply
      </button>
    </form>
  );
}
