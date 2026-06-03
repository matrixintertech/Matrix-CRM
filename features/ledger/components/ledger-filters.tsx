import { LedgerSourceType } from "@prisma/client";

type LedgerFiltersProps = {
  q?: string;
  sourceType?: LedgerSourceType;
  dateFrom?: string;
  dateTo?: string;
};

export function LedgerFilters({ q, sourceType, dateFrom, dateTo }: LedgerFiltersProps) {
  return (
    <form className="grid gap-3 rounded-2xl border border-[#d7e3f6] bg-white p-4 shadow-[0_10px_30px_rgba(25,56,120,0.06)] md:grid-cols-5">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="Search by payment, invoice, request, description"
        className="h-10 min-w-0 rounded-xl border border-[var(--border)] px-3 text-sm"
      />
      <select
        name="sourceType"
        defaultValue={sourceType ?? ""}
        className="h-10 rounded-xl border border-[var(--border)] px-3 text-sm"
      >
        <option value="">All sources</option>
        {Object.values(LedgerSourceType).map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
      <input type="date" name="dateFrom" defaultValue={dateFrom ?? ""} className="h-10 rounded-xl border border-[var(--border)] px-3 text-sm" />
      <input type="date" name="dateTo" defaultValue={dateTo ?? ""} className="h-10 rounded-xl border border-[var(--border)] px-3 text-sm" />
      <button type="submit" className="h-10 rounded-xl bg-[var(--primary)] px-3 text-sm font-semibold text-white shadow-[0_10px_18px_rgba(47,94,248,0.16)]">
        Apply
      </button>
    </form>
  );
}
