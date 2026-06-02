import Link from "next/link";

type LedgerSourceLinkProps = {
  sourceType: string;
  payment?: {
    paymentNumber: string;
    invoice?: {
      id: string;
      invoiceNumber: string;
    } | null;
  } | null;
  serviceRequest?: {
    id: string;
    serviceNumber: string;
  } | null;
};

export function LedgerSourceLink({ sourceType, payment, serviceRequest }: LedgerSourceLinkProps) {
  if (sourceType === "PAYMENT" && payment?.invoice?.id) {
    return (
      <div>
        <p className="font-medium text-slate-900">{payment.paymentNumber}</p>
        <Link href={`/invoices/${payment.invoice.id}`} className="text-xs text-[var(--primary)] underline">
          {payment.invoice.invoiceNumber}
        </Link>
      </div>
    );
  }

  if (serviceRequest?.id) {
    return (
      <Link href={`/service-requests/${serviceRequest.id}`} className="text-[var(--primary)] underline">
        {serviceRequest.serviceNumber}
      </Link>
    );
  }

  return <span>{payment?.paymentNumber ?? "-"}</span>;
}
