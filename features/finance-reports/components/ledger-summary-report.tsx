function toMoney(value: number) {
  return `INR ${value.toFixed(2)}`;
}

type LedgerSourceRow = {
  sourceType: string;
  count: number;
  totalDebit: number;
  totalCredit: number;
  netAmount: number;
};

export function LedgerSummaryReport({
  entriesCount,
  totalDebit,
  totalCredit,
  netAmount,
  sourceTypeCounts,
}: {
  entriesCount: number;
  totalDebit: number;
  totalCredit: number;
  netAmount: number;
  sourceTypeCounts: LedgerSourceRow[];
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-lg font-semibold">Ledger Summary</h2>
        <p className="text-sm text-[var(--muted)]">Read-only debit, credit, and source-type totals from posted ledger entries.</p>
      </div>

      <div className="grid gap-3 border-b border-[var(--border)] px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Entries", value: String(entriesCount) },
          { label: "Total Debit", value: toMoney(totalDebit) },
          { label: "Total Credit", value: toMoney(totalCredit) },
          { label: "Net", value: toMoney(netAmount) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-[#e5ebf6] bg-[#f9fbff] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-[#123064]">{item.value}</p>
          </div>
        ))}
      </div>

      {sourceTypeCounts.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[var(--muted)]">No ledger entries found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Source Type</th>
                <th className="px-4 py-3">Count</th>
                <th className="px-4 py-3">Debit</th>
                <th className="px-4 py-3">Credit</th>
                <th className="px-4 py-3">Net</th>
              </tr>
            </thead>
            <tbody>
              {sourceTypeCounts.map((row) => (
                <tr key={row.sourceType} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">{row.sourceType}</td>
                  <td className="px-4 py-3">{row.count}</td>
                  <td className="px-4 py-3">{toMoney(row.totalDebit)}</td>
                  <td className="px-4 py-3">{toMoney(row.totalCredit)}</td>
                  <td className="px-4 py-3">{toMoney(row.netAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
