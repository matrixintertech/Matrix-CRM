import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { ServicePartnerStatusActions } from "@/features/service-partners/components/service-partner-status-actions";
import { canManageServicePartners, getServicePartnerById } from "@/features/service-partners/services/service-partner.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ServicePartnerDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Service partner created successfully.";
  }
  if (code === "updated") {
    return "Service partner updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  if (code === "platform-protected") {
    return "This action is blocked for the platform service partner.";
  }
  return undefined;
}

export default async function ServicePartnerDetailPage({ params, searchParams }: ServicePartnerDetailPageProps) {
  const session = await requirePermission("service_partners.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const servicePartner = await getServicePartnerById(session, id);

  if (!servicePartner) {
    notFound();
  }

  const [canUpdate, canDelete] = await Promise.all([
    hasPermission(session, "service_partners.update"),
    hasPermission(session, "service_partners.delete"),
  ]);
  const canManage = canManageServicePartners(session);

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={servicePartner.name}
        description="Review service partner details and tenant-level statistics."
        action={canUpdate && canManage ? { label: "Edit service partner", href: `/service-partners/${servicePartner.id}/edit` } : undefined}
      />

      <div>
        <Link href="/service-partners" className="text-sm text-[var(--muted)] underline">
          Back to service partners
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Code</dt>
                <dd>{servicePartner.code}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={servicePartner.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Name</dt>
                <dd>{servicePartner.name}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Legal name</dt>
                <dd>{formatOptional(servicePartner.legalName)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Email</dt>
                <dd>{formatOptional(servicePartner.email)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Phone</dt>
                <dd>{formatOptional(servicePartner.phone)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Address</dt>
                <dd>{formatOptional(servicePartner.address)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">City</dt>
                <dd>{formatOptional(servicePartner.city)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">State</dt>
                <dd>{formatOptional(servicePartner.state)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Country</dt>
                <dd>{formatOptional(servicePartner.country)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Postal code</dt>
                <dd>{formatOptional(servicePartner.postalCode)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(servicePartner.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Updated</dt>
                <dd>{formatDateTime(servicePartner.updatedAt)}</dd>
              </div>
            </dl>
          </div>
          {canManage && canUpdate ? (
            <div className="rounded-md border border-[var(--border)] bg-white p-5">
              <h2 className="mb-3 text-base font-semibold">Status & deletion</h2>
              <ServicePartnerStatusActions
                servicePartnerId={servicePartner.id}
                canDelete={canDelete}
                canManage={canManage}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5 text-sm">
            <h2 className="mb-3 text-base font-semibold">Tenant usage</h2>
            <p className="text-[var(--muted)]">Users: {servicePartner._count.users}</p>
            <p className="text-[var(--muted)]">Clients: {servicePartner._count.clients}</p>
            <p className="text-[var(--muted)]">Branches: {servicePartner._count.branches}</p>
            <Link href={`/clients?q=${encodeURIComponent(servicePartner.name)}`} className="mt-3 inline-block text-sm underline">
              Open clients
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
