function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

export function VendorPaymentSummaryCard({
  count,
  totalAmount,
  settledAmount,
  cancelledAmount,
}: {
  count: number;
  totalAmount: unknown;
  settledAmount: unknown;
  cancelledAmount: unknown;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Vendor Payments", value: String(count) },
        { label: "Total Amount", value: toMoney(totalAmount) },
        { label: "Settled Amount", value: toMoney(settledAmount) },
        { label: "Cancelled Amount", value: toMoney(cancelledAmount) },
      ].map((card) => (
        <div key={card.label} className="rounded-xl border border-[#e5ebf6] bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{card.label}</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
