import Link from "next/link";

import { EmptyState } from "@/components/admin/empty-state";
import { PageHeader } from "@/components/admin/page-header";
import { createUserAction } from "@/features/users/actions/user.actions";
import { UserForm } from "@/features/users/components/user-form";
import { listAssignableRoles, listServicePartnersForUserForm } from "@/features/users/services/user.service";
import { hasPermission } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/rbac";
import { getStringParam, resolveSearchParams, type SearchParamsInput } from "@/lib/http/search-params";

type NewUserPageProps = {
  searchParams?: Promise<SearchParamsInput>;
};

function getErrorMessage(code?: string) {
  if (code === "validation") {
    return "Please provide a valid service partner and at least one of email or phone.";
  }
  if (code === "duplicate") {
    return "A user with the same email or phone already exists.";
  }
  if (code === "service-partner") {
    return "Service partner is required.";
  }
  if (code === "role") {
    return "Selected role is invalid for this service partner.";
  }
  if (code === "role-permission") {
    return "You do not have permission to assign roles.";
  }
  return undefined;
}

export default async function NewUserPage({ searchParams }: NewUserPageProps) {
  const session = await requirePermission("users.create");
  const [params, servicePartners, canAssignRoles] = await Promise.all([
    resolveSearchParams(searchParams),
    listServicePartnersForUserForm(session),
    Promise.all([hasPermission(session, "roles.assign"), hasPermission(session, "users.roles.assign")]).then(
      ([canAssignByRole, canAssignByUser]) => canAssignByRole || canAssignByUser
    ),
  ]);
  const roles = canAssignRoles ? await listAssignableRoles(session) : [];

  const errorMessage = getErrorMessage(getStringParam(params, "error"));

  return (
    <section className="space-y-5">
      <PageHeader title="Create User" description="Create a new user and assign them to a service partner." />
      <div>
        <Link href="/users" className="text-sm text-[var(--muted)] underline">
          Back to users
        </Link>
      </div>
      {servicePartners.length === 0 ? (
        <EmptyState title="No service partner found" description="Create a service partner before adding users." />
      ) : (
        <UserForm
          action={createUserAction}
          cancelHref="/users"
          servicePartners={servicePartners}
          roles={roles.map((role) => ({ id: role.id, name: role.name, key: role.key, scope: role.scope }))}
          canChooseServicePartner={session.user.isSuperAdmin}
          errorMessage={errorMessage}
        />
      )}
    </section>
  );
}
