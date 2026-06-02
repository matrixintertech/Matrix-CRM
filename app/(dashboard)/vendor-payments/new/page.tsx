import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createVendorPaymentAction } from "@/features/vendor-payments/actions/vendor-payment.actions";
import { VendorPaymentForm } from "@/features/vendor-payments/components/vendor-payment-form";
import {
  listPurchaseOrdersForVendorPaymentForm,
  listVendorPaymentServicePartnersForForm,
  listVendorsForVendorPaymentForm,
} from "@/features/vendor-payments/services/vendor-payment.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewVendorPaymentPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "vendor-payment-validation") {
    return "Please review the submitted values.";
  }
  if (code === "vendor-payment-duplicate") {
    return "Vendor payment number already exists for this service partner.";
  }
  if (code === "vendor-payment-mismatch") {
    return "Vendor and purchase order must belong to the selected service partner.";
  }
  return undefined;
}

export default async function NewVendorPaymentPage({ searchParams }: NewVendorPaymentPageProps) {
  const session = await requirePermission("vendor_payments.create");
  const [params, servicePartners] = await Promise.all([
    resolveSearchParams(searchParams),
    listVendorPaymentServicePartnersForForm(session),
  ]);
  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const requestedPurchaseOrderId = getStringParam(params, "purchaseOrderId");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;

  const [vendors, purchaseOrders] = await Promise.all([
    listVendorsForVendorPaymentForm(session, defaultServicePartnerId),
    listPurchaseOrdersForVendorPaymentForm(session, defaultServicePartnerId),
  ]);

  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Record Vendor Payment" description="Record a tenant-scoped vendor payment with optional purchase order linkage." />
      <div>
        <Link href="/vendor-payments" className="text-sm text-[var(--muted)] underline">
          Back to vendor payments
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before recording vendor payments." />
      ) : vendors.length === 0 ? (
        <EmptyState title="No vendors found" description="Create at least one active vendor before recording vendor payments." />
      ) : (
        <VendorPaymentForm
          action={createVendorPaymentAction}
          cancelHref="/vendor-payments"
          servicePartners={servicePartners}
          vendors={vendors}
          purchaseOrders={purchaseOrders}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
          defaultPurchaseOrderId={requestedPurchaseOrderId}
        />
      )}
    </section>
  );
}
