import { formatCurrencyInr, formatEnumLabel } from "@/lib/utils/format";

type PaymentSummaryCardProps = {
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
};

export function PaymentSummaryCard({ grandTotal, paidAmount, balanceDue, paymentStatus }: PaymentSummaryCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-[#6f84ab]">Payment Summary</h3>
      <div className="space-y-2 text-sm text-[var(--muted)]">
        <p>Grand Total: {formatCurrencyInr(grandTotal)}</p>
        <p>Paid Amount: {formatCurrencyInr(paidAmount)}</p>
        <p className="font-medium text-slate-700">Balance Due: {formatCurrencyInr(balanceDue)}</p>
        <p>Payment Status: {formatEnumLabel(paymentStatus)}</p>
      </div>
    </div>
  );
}
