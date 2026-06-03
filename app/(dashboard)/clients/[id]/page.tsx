import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { ClientStatusActions } from "@/features/clients/components/client-status-actions";
import { getClientById } from "@/features/clients/services/client.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";
import { formatDateTime, formatOptional } from "@/lib/utils/format";

type ClientDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Client created successfully.";
  }
  if (code === "updated") {
    return "Client updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function ClientDetailPage({ params, searchParams }: ClientDetailPageProps) {
  const session = await requirePermission("clients.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const client = await getClientById(session, id);

  if (!client) {
    notFound();
  }

  const [canUpdate, canDelete, canCreateBranch] = await Promise.all([
    hasPermission(session, "clients.update"),
    hasPermission(session, "clients.delete"),
    hasPermission(session, "branches.create"),
  ]);
  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="crm-page">
      <PageHeader
        title={client.name}
        description="Review client profile, status, and related branches."
        action={canUpdate ? { label: "Edit client", href: `/clients/${client.id}/edit` } : undefined}
      />
      <div>
        <Link href="/clients" className="crm-back-link">
          Back to clients
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Summary</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Code</dt>
                <dd>{client.code}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={client.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Name</dt>
                <dd>{client.name}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Legal name</dt>
                <dd>{formatOptional(client.legalName)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Email</dt>
                <dd>{formatOptional(client.email)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Phone</dt>
                <dd>{formatOptional(client.phone)}</dd>
              </div>
              <div className="md:col-span-2">
                <dt className="text-[var(--muted)]">Address</dt>
                <dd>{formatOptional(client.address)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">City</dt>
                <dd>{formatOptional(client.city)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">State</dt>
                <dd>{formatOptional(client.state)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Country</dt>
                <dd>{formatOptional(client.country)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Postal code</dt>
                <dd>{formatOptional(client.postalCode)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service partner</dt>
                <dd>
                  {client.servicePartner.name} ({client.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(client.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Updated</dt>
                <dd>{formatDateTime(client.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          {canUpdate ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Status & deletion</h2>
              <ClientStatusActions clientId={client.id} canDelete={canDelete} />
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          <div className="crm-panel">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">Branches</h2>
              {canCreateBranch ? (
                <Link
                  href={`/branches/new?servicePartnerId=${client.servicePartnerId}&clientId=${client.id}`}
                  className="text-xs underline"
                >
                  Add branch
                </Link>
              ) : null}
            </div>
            {client.branches.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No branches yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {client.branches.slice(0, 10).map((branch) => (
                  <li key={branch.id} className="rounded border border-[var(--border)] px-3 py-2">
                    <Link href={`/branches/${branch.id}`} className="font-medium underline">
                      {branch.name}
                    </Link>
                    <p className="text-xs text-[var(--muted)]">
                      {branch.code} • {formatOptional(branch.city)} {branch.state ? `, ${branch.state}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-[var(--muted)]">Total branches: {client._count.branches}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
