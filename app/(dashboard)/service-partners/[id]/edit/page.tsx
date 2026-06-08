import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { listActiveStatesWithCities } from "@/features/locations/services/location.service";
import { updateServicePartnerAction } from "@/features/service-partners/actions/service-partner.actions";
import { ServicePartnerForm } from "@/features/service-partners/components/service-partner-form";
import { canManageServicePartners, getServicePartnerById } from "@/features/service-partners/services/service-partner.service";
import { redirectForbidden } from "@/lib/auth/access-control";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type EditServicePartnerPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the form values.";
  }
  if (code === "duplicate") {
    return "Service partner code must be unique.";
  }
  if (code === "location") {
    return "Select a valid state and city combination.";
  }
  return undefined;
}

export default async function EditServicePartnerPage({ params, searchParams }: EditServicePartnerPageProps) {
  const session = await requirePermission("service_partners.update");
  if (!canManageServicePartners(session)) {
    redirectForbidden("/service-partners");
  }

  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const [servicePartner, states] = await Promise.all([getServicePartnerById(session, id), listActiveStatesWithCities()]);

  if (!servicePartner) {
    notFound();
  }

  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Edit Service Partner" description="Update tenant configuration and contact details." />
      <div>
        <Link href={`/service-partners/${id}`} className="text-sm text-[var(--muted)] underline">
          Back to details
        </Link>
      </div>
      <ServicePartnerForm
        action={updateServicePartnerAction.bind(null, id)}
        cancelHref={`/service-partners/${id}`}
        errorMessage={errorMessage}
        states={states}
        servicePartner={{
          code: servicePartner.code,
          name: servicePartner.name,
          legalName: servicePartner.legalName,
          email: servicePartner.email,
          phone: servicePartner.phone,
          gstNumber: servicePartner.gstNumber,
          shortProfile: servicePartner.shortProfile,
          bankName: servicePartner.bankName,
          bankBranch: servicePartner.bankBranch,
          bankIfscCode: servicePartner.bankIfscCode,
          bankAccountNumber: servicePartner.bankAccountNumber,
          address: servicePartner.address,
          city: servicePartner.city,
          state: servicePartner.state,
          country: servicePartner.country,
          postalCode: servicePartner.postalCode,
          status: servicePartner.status,
        }}
      />
    </section>
  );
}
