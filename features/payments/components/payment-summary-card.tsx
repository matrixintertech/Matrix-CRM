type PaymentSummaryCardProps = {
  grandTotal: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
};

function toMoney(value: number) {
  return `INR ${value.toFixed(2)}`;
}

export function PaymentSummaryCard({ grandTotal, paidAmount, balanceDue, paymentStatus }: PaymentSummaryCardProps) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold">Payment Summary</h3>
      <div className="space-y-1 text-xs text-[var(--muted)]">
        <p>Grand Total: {toMoney(grandTotal)}</p>
        <p>Paid Amount: {toMoney(paidAmount)}</p>
        <p className="font-medium text-slate-700">Balance Due: {toMoney(balanceDue)}</p>
        <p>Payment Status: {paymentStatus.replaceAll("_", " ")}</p>
      </div>
    </div>
  );
}
