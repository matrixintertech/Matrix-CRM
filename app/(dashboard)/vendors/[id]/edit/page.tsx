import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { updateVendorAction } from "@/features/vendors/actions/vendor.actions";
import { VendorForm } from "@/features/vendors/components/vendor-form";
import { getVendorById, listVendorServicePartnersForForm } from "@/features/vendors/services/vendor.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditVendorPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "Vendor code must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  return undefined;
}

export default async function EditVendorPage({ params, searchParams }: EditVendorPageProps) {
  const session = await requirePermission("vendors.update");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const vendor = await getVendorById(session, id);

  if (!vendor) {
    notFound();
  }

  const [servicePartners] = await Promise.all([listVendorServicePartnersForForm(session)]);
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Vendor" description="Update vendor details, verification, and compliance info." />
      <div>
        <Link href={`/vendors/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <VendorForm
        action={updateVendorAction.bind(null, id)}
        cancelHref={`/vendors/${id}`}
        servicePartners={servicePartners}
        canChooseServicePartner={session.user.isSuperAdmin}
        errorMessage={errorMessage}
        vendor={{
          servicePartnerId: vendor.servicePartnerId,
          code: vendor.code,
          name: vendor.name,
          email: vendor.email,
          phone: vendor.phone,
          status: vendor.status,
          isVerified: vendor.isVerified,
          gstNumber: vendor.gstNumber,
          panNumber: vendor.panNumber,
          address: vendor.address,
          city: vendor.city,
          state: vendor.state,
          country: vendor.country,
          postalCode: vendor.postalCode,
          vendorType: vendor.vendorType,
        }}
      />
    </section>
  );
}
