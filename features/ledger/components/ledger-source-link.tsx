import Link from "next/link";

type LedgerSourceLinkProps = {
  sourceType: string;
  payment?: {
    paymentNumber: string;
    invoice?: {
      id: string;
      invoiceNumber: string;
      vendorInvoiceNumber?: string;
    } | null;
  } | null;
  vendorPayment?: {
    id: string;
    paymentNumber: string;
    vendor?: {
      id: string;
      name: string;
      code: string;
    } | null;
    purchaseOrder?: {
      id: string;
      poNumber: string;
    } | null;
  } | null;
  serviceRequest?: {
    id: string;
    serviceNumber: string;
  } | null;
};

export function LedgerSourceLink({ sourceType, payment, vendorPayment, serviceRequest }: LedgerSourceLinkProps) {
  if (sourceType === "PAYMENT" && payment?.invoice?.id) {
    return (
      <div>
        <p className="font-medium text-slate-900">{payment.paymentNumber}</p>
        <Link href={`/invoices/${payment.invoice.id}`} className="text-xs text-[var(--primary)] underline">
          {payment.invoice.vendorInvoiceNumber ?? payment.invoice.invoiceNumber}
        </Link>
      </div>
    );
  }

  if (sourceType === "VENDOR_PAYMENT" && vendorPayment?.id) {
    return (
      <div>
        <Link href={`/vendor-payments/${vendorPayment.id}`} className="font-medium text-[var(--primary)] underline">
          {vendorPayment.paymentNumber}
        </Link>
        <p className="text-xs text-slate-600">
          {vendorPayment.vendor?.name ?? "-"}
          {vendorPayment.purchaseOrder?.poNumber ? ` | ${vendorPayment.purchaseOrder.poNumber}` : ""}
        </p>
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

  return <span>{payment?.paymentNumber ?? vendorPayment?.paymentNumber ?? "-"}</span>;
}
