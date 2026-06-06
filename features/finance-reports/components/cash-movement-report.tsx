import { formatCurrencyInr } from "@/lib/utils/format";

type CashMovementRow = {
  period: string;
  label: string;
  incoming: number;
  outgoing: number;
  net: number;
};

export function CashMovementReport({ rows }: { rows: CashMovementRow[] }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-white shadow-sm">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-lg font-semibold">Cash Movement</h2>
        <p className="text-sm text-[var(--muted)]">Outgoing cash from vendor invoice payments and vendor payments grouped by month.</p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-4 text-sm text-[var(--muted)]">No cash movement found.</p>
      ) : (
        <>
          <div className="space-y-3 p-4 md:hidden">
            {rows.map((row) => (
              <article key={row.period} className="rounded-2xl border border-[var(--border)] p-4">
                <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Incoming</p>
                    <p className="mt-1 text-sm text-slate-900">{formatCurrencyInr(row.incoming)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Outgoing</p>
                    <p className="mt-1 text-sm text-slate-900">{formatCurrencyInr(row.outgoing)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Net</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{formatCurrencyInr(row.net)}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="crm-scroll-shell hidden md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Incoming</th>
                <th className="px-4 py-3">Outgoing</th>
                <th className="px-4 py-3">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.period} className="border-t border-[var(--border)]">
                  <td className="px-4 py-3">{row.label}</td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.incoming)}</td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.outgoing)}</td>
                  <td className="px-4 py-3">{formatCurrencyInr(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </section>
  );
}
