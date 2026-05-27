import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { UserRoleForm } from "@/features/users/components/user-role-form";
import { UserStatusActions } from "@/features/users/components/user-status-actions";
import { getUserById, listAssignableRoles } from "@/features/users/services/user.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { formatDateTime, formatOptional } from "@/lib/utils/format";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "User created successfully.";
  }
  if (code === "updated") {
    return "User updated successfully.";
  }
  if (code === "role-assigned") {
    return "Role assigned successfully.";
  }
  if (code === "role-removed") {
    return "Role removed successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function UserDetailPage({ params, searchParams }: UserDetailPageProps) {
  const session = await requirePermission("users.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const user = await getUserById(session, id);

  if (!user) {
    notFound();
  }

  const [canUpdate, canDelete, canAssignRoles] = await Promise.all([
    hasPermission(session, "users.update"),
    hasPermission(session, "users.delete"),
    hasPermission(session, "roles.assign"),
  ]);
  const roles = canAssignRoles ? await listAssignableRoles(session) : [];

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="space-y-5">
      <PageHeader
        title={user.name?.trim() || user.email || user.phone || "User"}
        description="Review user details, status, and role assignments."
        action={canUpdate ? { label: "Edit user", href: `/users/${user.id}/edit` } : undefined}
      />

      <div>
        <Link href="/users" className="text-sm text-[var(--muted)] underline">
          Back to users
        </Link>
      </div>

      {errorMessage ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="rounded-md border border-[var(--border)] bg-white p-5">
            <h2 className="mb-4 text-base font-semibold">User details</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Name</dt>
                <dd>{formatOptional(user.name)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Email</dt>
                <dd>{formatOptional(user.email)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Phone</dt>
                <dd>{formatOptional(user.phone)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Status</dt>
                <dd>
                  <StatusBadge value={user.status} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service partner</dt>
                <dd>
                  {user.servicePartner.name} ({user.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(user.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Updated</dt>
                <dd>{formatDateTime(user.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          {canUpdate ? (
            <div className="rounded-md border border-[var(--border)] bg-white p-5">
              <h2 className="mb-3 text-base font-semibold">Status & access</h2>
              <UserStatusActions userId={user.id} canDelete={canDelete} />
            </div>
          ) : null}
        </div>

        <div className="space-y-5">
          {canAssignRoles ? <UserRoleForm userId={user.id} roles={roles} assignedRoles={user.roles} /> : null}
        </div>
      </div>
    </section>
  );
}
