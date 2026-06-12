import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { VendorStatusActions } from "@/features/vendors/components/vendor-status-actions";
import { getVendorById } from "@/features/vendors/services/vendor.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type VendorDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Vendor created successfully.";
  }
  if (code === "updated") {
    return "Vendor updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function VendorDetailPage({ params, searchParams }: VendorDetailPageProps) {
  const session = await requirePermission("vendors.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const vendor = await getVendorById(session, id);

  if (!vendor) {
    notFound();
  }

  const [canUpdate, canDelete] = await Promise.all([
    hasPermission(session, "vendors.update"),
    hasPermission(session, "vendors.delete"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={vendor.name}
        description="Review vendor profile, compliance details, and procurement linkage."
        action={canUpdate ? { label: "Edit vendor", href: `/vendors/${vendor.id}/edit` } : undefined}
      />
      <div>
        <Link href="/vendors" className="text-sm text-[var(--muted)] underline">
          Back to vendors
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="crm-panel">
          <h2 className="mb-4 text-base font-semibold">Summary</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Vendor code</dt>
              <dd>{vendor.code}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Status</dt>
              <dd>
                <StatusBadge value={vendor.status} />
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Verified</dt>
              <dd>{vendor.isVerified ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Vendor type</dt>
              <dd>{formatOptional(vendor.vendorType)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Email</dt>
              <dd>{formatOptional(vendor.email)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Phone</dt>
              <dd>{formatOptional(vendor.phone)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">GST Number</dt>
              <dd>{formatOptional(vendor.gstNumber)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">PAN Number</dt>
              <dd>{formatOptional(vendor.panNumber)}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-[var(--muted)]">Address</dt>
              <dd>{formatOptional(vendor.address)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">City / State</dt>
              <dd>
                {formatOptional(vendor.city)} / {formatOptional(vendor.state)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Country / Postal Code</dt>
              <dd>
                {formatOptional(vendor.country)} / {formatOptional(vendor.postalCode)}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Service partner</dt>
              <dd>
                {vendor.servicePartner.name} ({vendor.servicePartner.code})
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">RFQ references</dt>
              <dd>{vendor._count.rfqVendors}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Created</dt>
              <dd>{formatDateTime(vendor.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Updated</dt>
              <dd>{formatDateTime(vendor.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        {canUpdate ? (
          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Status and deletion</h2>
            <VendorStatusActions
              vendorId={vendor.id}
              currentStatus={vendor.status}
              isVerified={vendor.isVerified}
              canDelete={canDelete}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
