import { formatCurrencyInr } from "@/lib/utils/format";

export function FinanceSummaryCards({
  totalInvoiceAmount,
  totalReceivedAmount,
  outstandingReceivables,
  totalVendorPayments,
  netCashMovement,
  ledgerEntriesCount,
}: {
  totalInvoiceAmount: number;
  totalReceivedAmount: number;
  outstandingReceivables: number;
  totalVendorPayments: number;
  netCashMovement: number;
  ledgerEntriesCount: number;
}) {
  const cards = [
    { label: "Total Invoice Amount", value: formatCurrencyInr(totalInvoiceAmount) },
    { label: "Total Received Amount", value: formatCurrencyInr(totalReceivedAmount) },
    { label: "Outstanding Receivables", value: formatCurrencyInr(outstandingReceivables) },
    { label: "Total Vendor Payments", value: formatCurrencyInr(totalVendorPayments) },
    { label: "Net Cash Movement", value: formatCurrencyInr(netCashMovement) },
    { label: "Ledger Entries", value: String(ledgerEntriesCount) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="crm-stat-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#7d8eaf]">{card.label}</p>
          <p className="mt-1 text-2xl font-bold text-[#123064]">{card.value}</p>
        </div>
      ))}
    </div>
  );
}
