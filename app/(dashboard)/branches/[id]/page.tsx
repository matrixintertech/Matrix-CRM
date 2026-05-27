import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { PageHeader } from "@/components/admin/page-header";
import { deleteBranchAction } from "@/features/branches/actions/branch.actions";
import { getBranchById } from "@/features/branches/services/branch.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type BranchDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Branch created successfully.";
  }
  if (code === "updated") {
    return "Branch updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function BranchDetailPage({ params, searchParams }: BranchDetailPageProps) {
  const session = await requirePermission("branches.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const branch = await getBranchById(session, id);

  if (!branch) {
    notFound();
  }

  const [canUpdate, canDelete] = await Promise.all([
    hasPermission(session, "branches.update"),
    hasPermission(session, "branches.delete"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={branch.name}
        description="Review branch location and client mapping details."
        action={canUpdate ? { label: "Edit branch", href: `/branches/${branch.id}/edit` } : undefined}
      />
      <div>
        <Link href="/branches" className="text-sm text-[var(--muted)] underline">
          Back to branches
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="rounded-md border border-[var(--border)] bg-white p-5">
          <h2 className="mb-4 text-base font-semibold">Summary</h2>
          <dl className="grid gap-3 text-sm md:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Code</dt>
              <dd>{branch.code}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Name</dt>
              <dd>{branch.name}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Client</dt>
              <dd>
                <Link href={`/clients/${branch.client.id}`} className="underline">
                  {branch.client.name} ({branch.client.code})
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Service partner</dt>
              <dd>
                {branch.servicePartner.name} ({branch.servicePartner.code})
              </dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-[var(--muted)]">Address</dt>
              <dd>{formatOptional(branch.address)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">City</dt>
              <dd>{formatOptional(branch.city)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">State</dt>
              <dd>{formatOptional(branch.state)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Country</dt>
              <dd>{formatOptional(branch.country)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Postal code</dt>
              <dd>{formatOptional(branch.postalCode)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Created</dt>
              <dd>{formatDateTime(branch.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Updated</dt>
              <dd>{formatDateTime(branch.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        {canDelete ? (
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-3 text-base font-semibold">Danger zone</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">This will soft-delete the branch and hide it from listings.</p>
            <ConfirmAction
              action={deleteBranchAction.bind(null, branch.id)}
              label="Delete branch"
              intent="danger"
              fields={{ redirectTo: "/branches" }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
