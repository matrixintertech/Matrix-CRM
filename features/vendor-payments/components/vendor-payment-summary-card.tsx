import { formatCurrencyInr } from "@/lib/utils/format";

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
        { label: "Total Amount", value: formatCurrencyInr(totalAmount) },
        { label: "Settled Amount", value: formatCurrencyInr(settledAmount) },
        { label: "Cancelled Amount", value: formatCurrencyInr(cancelledAmount) },
      ].map((card) => (
        <div key={card.label} className="crm-stat-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{card.label}</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
