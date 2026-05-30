import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createVendorAction } from "@/features/vendors/actions/vendor.actions";
import { VendorForm } from "@/features/vendors/components/vendor-form";
import { listVendorServicePartnersForForm } from "@/features/vendors/services/vendor.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewVendorPageProps = {
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

export default async function NewVendorPage({ searchParams }: NewVendorPageProps) {
  const session = await requirePermission("vendors.create");
  const [params, servicePartners] = await Promise.all([resolveSearchParams(searchParams), listVendorServicePartnersForForm(session)]);
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const defaultServicePartnerId = session.user.isSuperAdmin ? getStringParam(params, "servicePartnerId") : session.user.servicePartnerId;

  return (
    <section className="space-y-5">
      <PageHeader title="Create Vendor" description="Create a tenant-scoped vendor for RFQ and procurement workflows." />
      <div>
        <Link href="/vendors" className="text-sm text-[var(--muted)] underline">
          Back to vendors
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding vendors." />
      ) : (
        <VendorForm
          action={createVendorAction}
          cancelHref="/vendors"
          servicePartners={servicePartners}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}
