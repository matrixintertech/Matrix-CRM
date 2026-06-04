import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfirmAction } from "@/components/admin/confirm-action";
import { PageHeader } from "@/components/admin/page-header";
import { StatusBadge } from "@/components/admin/status-badge";
import { deleteRoleAction } from "@/features/rbac/actions/role.actions";
import { RolePermissionForm } from "@/features/rbac/components/role-permission-form";
import { getRoleById } from "@/features/rbac/services/role.service";
import { listPermissions } from "@/features/rbac/services/permission.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { formatDateTime, formatOptional } from "@/lib/utils/format";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type RoleDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsInput>;
};

function getSuccessMessage(code?: string) {
  if (code === "created") {
    return "Role created successfully.";
  }
  if (code === "updated") {
    return "Role updated successfully.";
  }
  if (code === "permission-assigned") {
    return "Permission assigned successfully.";
  }
  if (code === "permission-removed") {
    return "Permission removed successfully.";
  }
  if (code === "permission-updated") {
    return "Role permissions updated successfully.";
  }
  return undefined;
}

function getErrorMessage(code?: string) {
  if (code === "protected") {
    return "This role is protected and cannot be modified in this way.";
  }
  if (code === "validation") {
    return "Request validation failed.";
  }
  return undefined;
}

export default async function RoleDetailPage({ params, searchParams }: RoleDetailPageProps) {
  const session = await requirePermission("roles.read");
  const [{ id }, paramsValue] = await Promise.all([params, resolveSearchParams(searchParams)]);
  const role = await getRoleById(session, id);

  if (!role) {
    notFound();
  }

  const isProtectedRole = role.isSystem || role.key === "super_admin";
  const [canUpdate, canDelete, canAssign] = await Promise.all([
    hasPermission(session, "roles.update"),
    hasPermission(session, "roles.delete"),
    hasPermission(session, "roles.assign"),
  ]);
  const permissionList = canAssign
    ? await listPermissions(session, { page: 1, pageSize: 500 })
    : { permissions: [], total: 0, page: 1, pageSize: 500, totalPages: 1 };

  const successMessage = getSuccessMessage(getStringParam(paramsValue, "success"));
  const errorMessage = getErrorMessage(getStringParam(paramsValue, "error"));

  return (
    <section className="crm-page">
      <PageHeader
        title={role.name}
        description="Review role settings and the permissions granted to assigned users."
        action={canUpdate ? { label: "Edit role", href: `/roles/${role.id}/edit` } : undefined}
      />

      <div>
        <Link href="/roles" className="crm-back-link">
          Back to roles
        </Link>
      </div>

      {errorMessage ? <p className="crm-alert crm-alert--error">{errorMessage}</p> : null}
      {successMessage ? <p className="crm-alert crm-alert--success">{successMessage}</p> : null}

      {isProtectedRole ? (
        <p className="crm-alert crm-alert--warning">
          This is a protected system role.
        </p>
      ) : null}
      <p className="crm-alert crm-alert--info">
        Users assigned to this role receive these permissions. Changing role permissions immediately affects role-based access.
      </p>

      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-5">
          <div className="crm-panel">
            <h2 className="mb-4 text-base font-semibold">Role details</h2>
            <dl className="grid gap-3 text-sm md:grid-cols-2">
              <div>
                <dt className="text-[var(--muted)]">Name</dt>
                <dd>{role.name}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Key</dt>
                <dd>{role.key}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Scope</dt>
                <dd>
                  <StatusBadge value={role.scope} />
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Role type</dt>
                <dd>{role.isSystem ? "System" : "Custom"}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Level</dt>
                <dd>{role.level}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Service partner</dt>
                <dd>
                  {role.servicePartner.name} ({role.servicePartner.code})
                </dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Description</dt>
                <dd>{formatOptional(role.description)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Created</dt>
                <dd>{formatDateTime(role.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-[var(--muted)]">Updated</dt>
                <dd>{formatDateTime(role.updatedAt)}</dd>
              </div>
            </dl>
          </div>

          {canDelete && !isProtectedRole ? (
            <div className="crm-panel">
              <h2 className="mb-3 text-base font-semibold">Delete role</h2>
              <p className="mb-3 text-sm text-[var(--muted)]">Soft-delete this role when it is no longer needed.</p>
              <ConfirmAction
                action={deleteRoleAction.bind(null, role.id)}
                label="Delete role"
                intent="danger"
                fields={{ redirectTo: "/roles?success=deleted" }}
              />
            </div>
          ) : null}

          <div className="crm-panel">
            <h2 className="mb-3 text-base font-semibold">Assigned users</h2>
            {role.users.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">No users are currently assigned to this role.</p>
            ) : (
              <div className="space-y-2">
                {role.users.map((assignment) => (
                  <div key={assignment.user.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                    <div className="font-medium text-slate-900">
                      {assignment.user.name?.trim() || assignment.user.email || assignment.user.id}
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {formatOptional(assignment.user.email)} · {assignment.user.status}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-5">
          {canAssign ? (
            <RolePermissionForm
              roleId={role.id}
              isProtectedRole={isProtectedRole}
              permissions={permissionList.permissions}
              assignedPermissions={role.permissions}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
