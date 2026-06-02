import { DataTable } from "@/components/admin/data-table";
import { LedgerSourceLink } from "@/features/ledger/components/ledger-source-link";
import { formatDateTime } from "@/lib/utils/format";

type LedgerRow = {
  id: string;
  sourceType: string;
  entryDate: Date;
  debitAmount: unknown;
  creditAmount: unknown;
  description: string | null;
  payment: {
    paymentNumber: string;
    invoice: {
      id: string;
      invoiceNumber: string;
    } | null;
  } | null;
  serviceRequest: {
    id: string;
    serviceNumber: string;
  } | null;
  createdBy: {
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
};

function toMoney(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "-";
  }
  return `INR ${numeric.toFixed(2)}`;
}

function actorLabel(actor: LedgerRow["createdBy"]) {
  if (!actor) {
    return "-";
  }
  return actor.name?.trim() || actor.email || actor.phone || "-";
}

export function LedgerTable({ entries }: { entries: LedgerRow[] }) {
  return (
    <DataTable
      rows={entries}
      getRowKey={(entry) => entry.id}
      columns={[
        {
          header: "Date",
          cell: (entry) => formatDateTime(entry.entryDate),
        },
        {
          header: "Source",
          cell: (entry) => (
            <LedgerSourceLink sourceType={entry.sourceType} payment={entry.payment} serviceRequest={entry.serviceRequest} />
          ),
        },
        {
          header: "Type",
          cell: (entry) => entry.sourceType,
        },
        {
          header: "Debit",
          cell: (entry) => toMoney(entry.debitAmount),
        },
        {
          header: "Credit",
          cell: (entry) => toMoney(entry.creditAmount),
        },
        {
          header: "Description",
          cell: (entry) => entry.description?.trim() || "-",
        },
        {
          header: "Created By",
          cell: (entry) => actorLabel(entry.createdBy),
        },
      ]}
    />
  );
}
