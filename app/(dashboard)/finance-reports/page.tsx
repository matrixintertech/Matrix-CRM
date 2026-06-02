import { InvoiceStatus, LedgerSourceType, PaymentStatus } from "@prisma/client";

import { PageHeader } from "@/components/admin/page-header";
import { CashMovementReport } from "@/features/finance-reports/components/cash-movement-report";
import { FinanceReportFilters } from "@/features/finance-reports/components/finance-report-filters";
import { FinanceSummaryCards } from "@/features/finance-reports/components/finance-summary-cards";
import { LedgerSummaryReport } from "@/features/finance-reports/components/ledger-summary-report";
import { PayablesReport } from "@/features/finance-reports/components/payables-report";
import { ReceivablesReport } from "@/features/finance-reports/components/receivables-report";
import { getFinanceReportData } from "@/features/finance-reports/services/finance-report.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type FinanceReportsPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

export default async function FinanceReportsPage({ searchParams }: FinanceReportsPageProps) {
  const session = await requirePermission("reports.read");
  const params = await resolveSearchParams(searchParams);

  const q = getStringParam(params, "q");
  const invoiceStatus = Object.values(InvoiceStatus).find((value) => value === getStringParam(params, "invoiceStatus"));
  const paymentStatus = Object.values(PaymentStatus).find((value) => value === getStringParam(params, "paymentStatus"));
  const sourceType = Object.values(LedgerSourceType).find((value) => value === getStringParam(params, "sourceType"));
  const dateFrom = getStringParam(params, "dateFrom");
  const dateTo = getStringParam(params, "dateTo");

  const report = await getFinanceReportData(session, {
    q,
    invoiceStatus,
    paymentStatus,
    sourceType,
    dateFrom: dateFrom ? new Date(dateFrom) : undefined,
    dateTo: dateTo ? new Date(dateTo) : undefined,
  });

  return (
    <section className="space-y-5">
      <PageHeader
        title="Finance Reports"
        description="Read-only tenant-scoped finance reporting built from invoices, payments, vendor payments, and ledger postings."
      />

      <FinanceSummaryCards
        totalInvoiceAmount={report.summary.totalInvoiceAmount}
        totalReceivedAmount={report.summary.totalReceivedAmount}
        outstandingReceivables={report.summary.outstandingReceivables}
        totalVendorPayments={report.summary.totalVendorPayments}
        netCashMovement={report.summary.netCashMovement}
        ledgerEntriesCount={report.summary.ledgerEntriesCount}
      />

      <FinanceReportFilters
        q={q}
        invoiceStatus={invoiceStatus}
        paymentStatus={paymentStatus}
        sourceType={sourceType}
        dateFrom={dateFrom ?? undefined}
        dateTo={dateTo ?? undefined}
      />

      <div className="grid gap-5">
        <ReceivablesReport rows={report.receivables} />
        <PayablesReport rows={report.payables} />
        <div className="grid gap-5 xl:grid-cols-2">
          <CashMovementReport rows={report.cashMovement} />
          <LedgerSummaryReport
            entriesCount={report.ledgerSummary.entriesCount}
            totalDebit={report.ledgerSummary.totalDebit}
            totalCredit={report.ledgerSummary.totalCredit}
            netAmount={report.ledgerSummary.netAmount}
            sourceTypeCounts={report.ledgerSummary.sourceTypeCounts}
          />
        </div>
      </div>
    </section>
  );
}
