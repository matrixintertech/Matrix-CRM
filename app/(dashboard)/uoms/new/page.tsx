import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createUomAction } from "@/features/uoms/actions/uom.actions";
import { UomForm } from "@/features/uoms/components/uom-form";
import { listUomServicePartnersForForm } from "@/features/uoms/services/uom.service";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { getSafeRedirectPath } from "@/lib/utils/safe-redirect";

type NewUomPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please review the submitted values.";
  }
  if (code === "duplicate") {
    return "UOM code must be unique within the selected service partner.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  return undefined;
}

export default async function NewUomPage({ searchParams }: NewUomPageProps) {
  const session = await requirePermission("items.create");
  const [params, servicePartners] = await Promise.all([resolveSearchParams(searchParams), listUomServicePartnersForForm(session)]);
  const requestedServicePartnerId = getStringParam(params, "servicePartnerId");
  const redirectTo = getSafeRedirectPath(getStringParam(params, "redirectTo"), "/uoms");
  const defaultServicePartnerId = session.user.isSuperAdmin ? requestedServicePartnerId : session.user.servicePartnerId;
  const errorMessage = getErrorMessage(getStringParam(params, "error"));
  const backLabel = redirectTo.startsWith("/items") ? "Back to item" : "Back to UOMs";

  return (
    <section className="space-y-5">
      <PageHeader title="Create UOM" description="Create a reusable Unit of Measurement master." />
      <div>
        <Link href={redirectTo} className="text-sm text-[var(--muted)] underline">
          {backLabel}
        </Link>
      </div>

      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create or activate a service partner before adding UOMs." />
      ) : (
        <UomForm
          action={createUomAction}
          cancelHref={redirectTo}
          redirectTo={redirectTo === "/uoms" ? undefined : redirectTo}
          servicePartners={servicePartners}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
          defaultServicePartnerId={defaultServicePartnerId}
        />
      )}
    </section>
  );
}
