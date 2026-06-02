import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateVendorPaymentAction } from "@/features/vendor-payments/actions/vendor-payment.actions";
import { VendorPaymentForm } from "@/features/vendor-payments/components/vendor-payment-form";
import {
  getVendorPaymentById,
  listPurchaseOrdersForVendorPaymentForm,
  listVendorPaymentServicePartnersForForm,
  listVendorsForVendorPaymentForm,
} from "@/features/vendor-payments/services/vendor-payment.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditVendorPaymentPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "vendor-payment-validation") {
    return "Please review the submitted values.";
  }
  if (code === "vendor-payment-mismatch") {
    return "Vendor payment update blocked by tenant scope mismatch.";
  }
  if (code === "not-found") {
    return "Vendor payment record could not be found.";
  }
  return undefined;
}

export default async function EditVendorPaymentPage({ params, searchParams }: EditVendorPaymentPageProps) {
  const session = await requirePermission("vendor_payments.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const vendorPayment = await getVendorPaymentById(session, id);

  if (!vendorPayment) {
    notFound();
  }

  const [servicePartners, vendors, purchaseOrders] = await Promise.all([
    listVendorPaymentServicePartnersForForm(session),
    listVendorsForVendorPaymentForm(session, vendorPayment.servicePartnerId),
    listPurchaseOrdersForVendorPaymentForm(session, vendorPayment.servicePartnerId),
  ]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title={`Edit ${vendorPayment.paymentNumber}`} description="Update vendor payment details and status." />
      <div>
        <Link href={`/vendor-payments/${vendorPayment.id}`} className="text-sm text-[var(--muted)] underline">
          Back to vendor payment
        </Link>
      </div>

      <VendorPaymentForm
        action={updateVendorPaymentAction.bind(null, vendorPayment.id)}
        cancelHref={`/vendor-payments/${vendorPayment.id}`}
        servicePartners={servicePartners}
        vendors={vendors}
        purchaseOrders={purchaseOrders}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        defaultServicePartnerId={vendorPayment.servicePartnerId}
        defaultPurchaseOrderId={vendorPayment.purchaseOrderId ?? undefined}
        vendorPayment={{
          servicePartnerId: vendorPayment.servicePartnerId,
          vendorId: vendorPayment.vendorId,
          purchaseOrderId: vendorPayment.purchaseOrderId,
          status: vendorPayment.status,
          paymentDate: vendorPayment.paidAt ? new Date(vendorPayment.paidAt).toISOString().slice(0, 10) : null,
          amount: Number(vendorPayment.amount).toFixed(2),
          notes: vendorPayment.remarks,
        }}
      />
    </section>
  );
}
