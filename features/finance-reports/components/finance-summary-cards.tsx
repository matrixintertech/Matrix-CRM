import { formatCurrencyInr } from "@/lib/utils/format";

export function FinanceSummaryCards({
  totalVendorInvoiceAmount,
  totalInvoicePaymentsMade,
  outstandingPayables,
  totalStandaloneVendorPayments,
  totalOutgoingPayments,
  ledgerEntriesCount,
}: {
  totalVendorInvoiceAmount: number;
  totalInvoicePaymentsMade: number;
  outstandingPayables: number;
  totalStandaloneVendorPayments: number;
  totalOutgoingPayments: number;
  ledgerEntriesCount: number;
}) {
  const cards = [
    { label: "Total Vendor Invoice Amount", value: formatCurrencyInr(totalVendorInvoiceAmount) },
    { label: "Invoice Payments Made", value: formatCurrencyInr(totalInvoicePaymentsMade) },
    { label: "Outstanding Payables", value: formatCurrencyInr(outstandingPayables) },
    { label: "Other Vendor Payments", value: formatCurrencyInr(totalStandaloneVendorPayments) },
    { label: "Total Outgoing Cash", value: formatCurrencyInr(totalOutgoingPayments) },
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
