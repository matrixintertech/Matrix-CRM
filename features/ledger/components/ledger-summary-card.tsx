type LedgerSummaryCardProps = {
  entriesCount: number;
  totalDebit: number;
  totalCredit: number;
  netAmount: number;
};

function toMoney(value: number) {
  return `INR ${value.toFixed(2)}`;
}

export function LedgerSummaryCard({ entriesCount, totalDebit, totalCredit, netAmount }: LedgerSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[#d7e3f6] bg-white p-5 shadow-[0_10px_30px_rgba(25,56,120,0.06)]">
      <h2 className="text-lg font-semibold text-[#122447]">Ledger Summary</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-[#e5ebf6] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">Entries</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{entriesCount}</p>
        </div>
        <div className="rounded-xl border border-[#e5ebf6] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">Total Debit</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{toMoney(totalDebit)}</p>
        </div>
        <div className="rounded-xl border border-[#e5ebf6] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">Total Credit</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{toMoney(totalCredit)}</p>
        </div>
        <div className="rounded-xl border border-[#e5ebf6] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">Net Amount</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{toMoney(netAmount)}</p>
        </div>
      </div>
    </div>
  );
}
